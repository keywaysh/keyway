// Package env provides utilities for parsing and manipulating .env files.
package env

import (
	"fmt"
	"sort"
	"strings"
)

// ParseError reports .env content that cannot be read without guessing.
type ParseError struct {
	Line int // 1-based line where the problem starts
	Msg  string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("line %d: %s", e.Line, e.Msg)
}

// Parse reads a .env file: one that `keyway pull` wrote, possibly edited by hand.
//
// A value in double or single quotes may span lines (CRLF line ends read as \n), and inside
// double quotes \" stands for a quote. Blank lines, comments and lines without "=" are
// skipped. A single-line value that starts and ends with the same quote loses them, as in
// earlier versions; unlike them, a trailing tab is kept, a comment may follow a closing double
// quote, and a double quote that never closes or text after it is an error rather than a value
// cut at its first line. A value that merely starts with a single quote ('abc) reads as is.
//
// Where text reads more than one way (a line ending with \", an escaped quote or a backslash
// ending the value; a single quote closed on a later line), Parse keeps the only reading whose
// following lines hold, preferring, for double quotes, the server's own text. Otherwise it
// returns a *ParseError rather than guess.
//
// A file cannot carry every value: an unquoted value ending with \r reads without it, one
// wrapped in single quotes ('x') without them, and \r\n inside a quoted value as \n.
// ParseServer reads the server's text exactly.
func Parse(content string) (map[string]string, error) {
	return newParser(strings.TrimPrefix(content, "\uFEFF")).parse(lenient)
}

// ParseServer reads the .env text the server sends (its toEnvFormat) exactly. Single quotes,
// \r and tabs are part of values there. It returns a *ParseError for text the server does not
// write.
func ParseServer(content string) (map[string]string, error) {
	return newParser(content).parse(server)
}

// grammar is a set of rules for reading .env lines.
type grammar int

const (
	// lenient: what people write; see Parse.
	lenient grammar = iota
	// server: exactly what toEnvFormat writes. Every line is KEY=value, and a value is in
	// double quotes, each of its quotes escaped, if and only if it holds a space, a newline or
	// a quote. Nothing else is escaped.
	server
	// written: the server's lines plus blank lines and comments, as in a pulled file someone
	// edited. Used to tell readings apart.
	written
)

// Lines scanned in total before giving up: bounds the work on adversarial content.
const maxScannedLines = 5_000_000

type parser struct {
	lines   []string
	holds   [3]map[int]bool // per grammar, whether the lines from an index read to the end
	scanned int
}

func newParser(content string) *parser {
	p := &parser{lines: strings.Split(content, "\n")}
	for g := range p.holds {
		p.holds[g] = map[int]bool{}
	}
	return p
}

// statement is a KEY=value line. For a quoted value, value is the text after "=".
type statement struct {
	key    string
	value  string
	quoted bool
}

// split reads a line under grammar g. skip: not a statement, and g skips it. ok=false: g
// does not allow the line. In check mode, lenient does not skip lines without "=".
func split(line string, g grammar, check bool) (st statement, skip, ok bool) {
	trimmed := strings.TrimSpace(line)
	if g != server && (trimmed == "" || strings.HasPrefix(trimmed, "#")) {
		return statement{}, true, true
	}
	eq := strings.IndexByte(line, '=')

	if g == lenient {
		if eq == -1 || strings.TrimSpace(line[:eq]) == "" {
			return statement{}, !check, !check
		}
		key, rest := strings.TrimSpace(line[:eq]), line[eq+1:]
		if rest != "" && (rest[0] == '"' || rest[0] == '\'') {
			return statement{key: key, value: rest, quoted: true}, false, true
		}
		return statement{key: key, value: strings.TrimRight(rest, " \r")}, false, true
	}

	// The server writes KEY=value lines only, quoting exactly the values that need it.
	if eq <= 0 {
		return statement{}, false, false
	}
	key, rest := line[:eq], line[eq+1:]
	if strings.HasPrefix(rest, `"`) {
		return statement{key: key, value: rest, quoted: true}, false, true
	}
	if strings.ContainsAny(rest, ` "`) {
		return statement{}, false, false
	}
	return statement{key: key, value: rest}, false, true
}

// endsHere reports whether only empty lines remain from line i: the server's text may end
// with a newline.
func (p *parser) endsHere(i int) bool {
	for ; i < len(p.lines); i++ {
		if p.lines[i] != "" {
			return false
		}
	}
	return true
}

// parse reads every line under grammar g (lenient or server).
func (p *parser) parse(g grammar) (map[string]string, error) {
	out := make(map[string]string)
	for i := 0; i < len(p.lines); {
		if g == server && p.endsHere(i) {
			break
		}
		st, skip, ok := split(p.lines[i], g, false)
		switch {
		case !ok:
			return nil, &ParseError{Line: i + 1, Msg: "not a line of the server's .env format"}
		case skip:
			i++
		case !st.quoted:
			out[st.key] = st.value
			i++
		default:
			r, err := p.choose(i, st.value, g)
			if err != nil {
				return nil, err
			}
			out[st.key] = p.text(i, st.value, r, g)
			i = r.next
		}
	}
	return out, nil
}

// holdsFrom reports whether the lines from index from read to the end under grammar g, for
// some reading of each quoted value.
func (p *parser) holdsFrom(g grammar, from int) bool {
	if held, ok := p.holds[g][from]; ok {
		return held
	}
	var path []int // statements on the way share the outcome
	held := true
	for i := from; i < len(p.lines); {
		if known, ok := p.holds[g][i]; ok {
			held = known
			break
		}
		path = append(path, i)
		if g == server && p.endsHere(i) {
			break
		}
		st, skip, ok := split(p.lines[i], g, true)
		if !ok {
			held = false
			break
		}
		if skip || !st.quoted {
			i++
			continue
		}
		readings, fallback, _ := p.readings(i, st.value, g)
		held = false
		for _, r := range readings {
			if p.holdsFrom(g, r.next) {
				held = true
				break
			}
		}
		if !held && fallback {
			held = p.holdsFrom(g, i+1)
		}
		break
	}
	for _, i := range path {
		p.holds[g][i] = held
	}
	return held
}

// reading is one way to read a quoted value. Its text is built only once it is chosen.
type reading struct {
	value    string // set when final: single-line readings of single-quoted values
	final    bool
	endLine  int  // line where the value ends
	endAt    int  // index in that line's text where the value ends
	next     int  // line after the value
	asServer bool // the server writes this value this way
}

// choose picks the reading of the quoted value starting on line start; rest is that line's
// text after "=".
func (p *parser) choose(start int, rest string, g grammar) (reading, error) {
	readings, fallback, sawClosing := p.readings(start, rest, g)
	if p.scanned > maxScannedLines {
		return reading{}, &ParseError{Line: start + 1, Msg: "too complex to read safely"}
	}

	switch len(readings) {
	case 1:
		return readings[0], nil
	case 0:
		// Read the line as earlier versions did when it starts and ends with the same quote,
		// like a hand-written "say "hi"".
		if fallback {
			line := strings.TrimRight(rest, " \r")
			return reading{value: line[1 : len(line)-1], final: true, next: start + 1}, nil
		}
		if sawClosing {
			return reading{}, &ParseError{Line: start + 1, Msg: "unexpected text after the closing quote"}
		}
		return reading{}, &ParseError{Line: start + 1, Msg: "quote never closed"}
	}

	// Several readings: keep the one whose following lines hold. For double quotes in a file,
	// prefer the server's own readings: the text pull wrote, then with comments and blank
	// lines. The server never writes single quotes, so its readings settle nothing there.
	holds := func(in grammar, onlyServer bool) func(reading) bool {
		return func(r reading) bool { return (!onlyServer || r.asServer) && p.holdsFrom(in, r.next) }
	}
	tiers := []func(reading) bool{holds(g, false)}
	if g == lenient && rest[0] == '"' {
		tiers = []func(reading) bool{holds(server, true), holds(written, true), holds(lenient, false)}
	}
	for _, holding := range tiers {
		var kept []reading
		for _, r := range readings {
			if holding(r) {
				kept = append(kept, r)
			}
		}
		if p.scanned > maxScannedLines {
			// A reading cut short by the budget looks like one that does not hold
			return reading{}, &ParseError{Line: start + 1, Msg: "too complex to read safely"}
		}
		if len(kept) == 1 {
			return kept[0], nil
		}
		if len(kept) > 1 {
			return reading{}, &ParseError{
				Line: start + 1,
				Msg:  "cannot tell where this quoted value ends: it reads more than one way",
			}
		}
	}
	return reading{}, &ParseError{
		Line: start + 1,
		Msg:  "cannot tell where this quoted value ends: no reading leaves valid lines after it",
	}
}

// readings lists the ways grammar g can read the quoted value starting on line start, in line
// order; rest is that line's text after "=". fallback reports whether, under the lenient
// grammar, that line on its own starts and ends with the quote; sawClosing whether a closing
// quote was found at all. Under the server's grammars, only the server's own readings count.
func (p *parser) readings(start int, rest string, g grammar) (readings []reading, fallback, sawClosing bool) {
	quote := rest[0]
	firstLine := strings.TrimRight(rest, " \r")
	fallback = g == lenient && len(firstLine) >= 2 && firstLine[len(firstLine)-1] == quote

	if quote == '\'' {
		// The server never writes single quotes, but writes a value that merely starts with
		// one as is ('abc123, 'it's). Read single-line values as earlier versions did.
		asIs := !strings.ContainsAny(firstLine, ` "`) // the server would write it unquoted
		if at := strings.IndexByte(rest[1:], '\''); at >= 0 {
			value, asServer := firstLine, asIs // as is, like 'it's
			if strings.TrimSpace(rest[at+2:]) == "" {
				value, asServer = rest[1:at+1], false
			} else if fallback {
				value, asServer = firstLine[1:len(firstLine)-1], false
			}
			return []reading{{value: value, final: true, next: start + 1, asServer: asServer}}, fallback, true
		}
		readings = append(readings, reading{value: firstLine, final: true, next: start + 1, asServer: asIs})
	}

	add := func(r reading) {
		if g == lenient || r.asServer {
			readings = append(readings, r)
		}
	}
	// The server quotes a value only when it holds a space, a newline or a quote.
	quotable := func(line int, text string) bool {
		return line > start || strings.ContainsAny(text, ` "`)
	}
	segment := rest[1:]
	for line := start; ; {
		p.scanned++
		if at := closingQuote(segment, quote); at >= 0 {
			after := segment[at+1:]
			if isBlankOrComment(after, quote) {
				add(reading{
					endLine:  line,
					endAt:    at,
					next:     line + 1,
					asServer: quote == '"' && after == "" && quotable(line, segment[:at]),
				})
			}
			return readings, fallback, true
		}
		// `\"` ending a line is an escaped quote, or a backslash ending the value followed by
		// the closing quote: keep both readings.
		if quote == '"' && strings.HasSuffix(strings.TrimRight(segment, " \t\r"), `\"`) {
			end := strings.LastIndex(segment, `"`)
			add(reading{
				endLine:  line,
				endAt:    end,
				next:     line + 1,
				asServer: end == len(segment)-1 && quotable(line, segment[:end]),
			})
		}
		line++
		if line >= len(p.lines) || p.scanned > maxScannedLines {
			return readings, fallback, false
		}
		segment = p.lines[line]
	}
}

// text builds the value of reading r of the quoted value starting on line start. In a file,
// a CRLF line end inside the value reads as \n.
func (p *parser) text(start int, rest string, r reading, g grammar) string {
	if r.final {
		return r.value
	}
	if r.endLine == start {
		return unescape(rest[1:1+r.endAt], rest[0])
	}
	lineText := func(text string) string {
		if g == lenient {
			return strings.TrimSuffix(text, "\r")
		}
		return text
	}
	var b strings.Builder
	b.WriteString(lineText(rest[1:]))
	for line := start + 1; line < r.endLine; line++ {
		b.WriteString("\n")
		b.WriteString(lineText(p.lines[line]))
	}
	b.WriteString("\n")
	b.WriteString(p.lines[r.endLine][:r.endAt])
	return unescape(b.String(), rest[0])
}

// closingQuote returns the index of the quote that closes the value in segment, or -1.
// Inside double quotes, a quote preceded by a backslash is part of the value.
func closingQuote(segment string, quote byte) int {
	for i := 0; i < len(segment); i++ {
		if segment[i] == quote && (quote == '\'' || i == 0 || segment[i-1] != '\\') {
			return i
		}
	}
	return -1
}

// unescape turns the server's escaped text back into the value: inside double quotes, each
// quote got a backslash in front of it, and nothing else was escaped.
func unescape(text string, quote byte) string {
	if quote != '"' {
		return text
	}
	return strings.ReplaceAll(text, `\"`, `"`)
}

// isBlankOrComment reports whether rest, after a closing quote, ends the value. A comment may
// follow a double quote only: the server writes 'x'#y unquoted.
func isBlankOrComment(rest string, quote byte) bool {
	rest = strings.TrimSpace(rest)
	return rest == "" || (quote == '"' && strings.HasPrefix(rest, "#"))
}

// CountLines counts non-empty, non-comment lines in env content.
func CountLines(content string) int {
	count := 0
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			count++
		}
	}
	return count
}

// Merge merges vault content with local-only secrets.
// Returns the merged content with local-only secrets appended.
func Merge(vaultContent string, local, vault map[string]string) string {
	// Start with vault content
	result := strings.TrimRight(vaultContent, "\n")

	// Find local-only secrets and collect keys for sorting
	var localOnlyKeys []string
	for key := range local {
		if _, exists := vault[key]; !exists {
			localOnlyKeys = append(localOnlyKeys, key)
		}
	}

	if len(localOnlyKeys) > 0 {
		// Sort keys for deterministic output
		sort.Strings(localOnlyKeys)

		result += "\n\n# Local variables (not in vault)\n"
		for _, key := range localOnlyKeys {
			result += FormatLine(key, local[key]) + "\n"
		}
	} else {
		result += "\n"
	}

	return result
}
