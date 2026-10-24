// Package env provides utilities for parsing and manipulating .env files.
package env

import (
	"fmt"
	"sort"
	"strings"
)

// ParseError reports .env content that cannot be read without guessing.
type ParseError struct {
	Line int // 1-based line where the value starts
	Msg  string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("line %d: %s", e.Line, e.Msg)
}

// Parse parses env file content and returns a map of key-value pairs.
//
// It reads what `keyway pull` writes (the server's format) back exactly: a value in double or
// single quotes may span lines, and inside double quotes \" stands for a quote. Single-line
// values read as in earlier versions. Content it could only read by guessing, such as an
// unterminated double quote, is a *ParseError rather than a cut value.
//
// The format cannot carry every value: an unquoted value ending with \r reads without it,
// and one wrapped in single quotes ('x') reads without them, as earlier versions did. Read
// exact values from the API instead of from .env content.
func Parse(content string) (map[string]string, error) {
	p := &parser{
		lines: strings.Split(strings.TrimPrefix(content, "\uFEFF"), "\n"),
		holds: map[int]bool{},
	}
	result := make(map[string]string)
	if err := p.parse(0, result); err != nil {
		return nil, err
	}
	return result, nil
}

// Lines scanned in total before giving up: bounds the work on adversarial content.
const maxScannedLines = 5_000_000

type parser struct {
	lines   []string
	holds   map[int]bool // memo for holdsFrom
	scanned int
}

// reading is one way to read a quoted value. Its text is built only once it is chosen.
type reading struct {
	value   string // set for single-line readings of single-quoted values
	literal bool   // value is final
	endLine int    // line where the value ends
	endAt   int    // index in that line's text where the value ends
	next    int    // line after the value
	closed  bool   // ends on a closing quote, not on a backslash before it
}

// parse reads lines[from:] into out.
func (p *parser) parse(from int, out map[string]string) error {
	for i := from; i < len(p.lines); {
		key, value, quoted, ok := splitAssignment(p.lines[i])
		if !ok {
			i++ // blank, comment, or a line without "=": skipped, as in earlier versions
			continue
		}
		if !quoted {
			out[key] = value
			i++
			continue
		}
		r, err := p.quoted(i, value, false)
		if err != nil {
			return err
		}
		out[key] = p.text(i, value, r)
		i = r.next
	}
	return nil
}

// holdsFrom reports whether lines[from:] read without error when every non-blank,
// non-comment line must be an assignment. It tells apart the readings of an ambiguous value:
// the server's output always holds, a reading that cuts it elsewhere leaves stray lines.
func (p *parser) holdsFrom(from int) bool {
	if held, ok := p.holds[from]; ok {
		return held
	}
	// The outcome from each statement on the way is the same, so remember it for all.
	var path []int
	held := true
	for i := from; i < len(p.lines); {
		if known, ok := p.holds[i]; ok {
			held = known
			break
		}
		path = append(path, i)
		trimmed := strings.TrimSpace(p.lines[i])
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			i++
			continue
		}
		_, value, quoted, ok := splitAssignment(p.lines[i])
		if !ok {
			held = false
			break
		}
		if !quoted {
			i++
			continue
		}
		r, err := p.quoted(i, value, true)
		if err != nil {
			held = false
			break
		}
		i = r.next
	}
	for _, i := range path {
		p.holds[i] = held
	}
	return held
}

// quoted chooses how to read the quoted value starting on line start; first is that line's
// text after "=". In check mode (from holdsFrom) any reading whose remaining lines hold will do.
func (p *parser) quoted(start int, first string, check bool) (reading, error) {
	readings, fallback, sawClosing := p.readings(start, first)
	if p.scanned > maxScannedLines {
		return reading{}, &ParseError{Line: start + 1, Msg: "too complex to read safely"}
	}

	switch {
	case len(readings) == 1:
		return readings[0], nil
	case len(readings) > 1:
		var holding []reading
		for _, r := range readings {
			if p.holdsFrom(r.next) {
				holding = append(holding, r)
			}
		}
		if len(holding) == 1 || (len(holding) > 1 && check) {
			return holding[0], nil
		}
		if len(holding) > 1 {
			return reading{}, &ParseError{
				Line: start + 1,
				Msg:  "ambiguous quoted value: it may end with a backslash or go on to the next lines",
			}
		}
		if check {
			return reading{}, &ParseError{Line: start + 1, Msg: "no reading holds"}
		}
		// None holds because hand-written lines follow: prefer the usual reading, the one
		// that ends on a closing quote.
		for _, r := range readings {
			if r.closed {
				return r, nil
			}
		}
		return readings[0], nil
	}

	// No reading: read the line as earlier versions did (outer quotes removed) when it
	// starts and ends with the same quote, e.g. a hand-written "say "hi"".
	if fallback && !check {
		line := strings.TrimRight(first, " \r")
		return reading{value: line[1 : len(line)-1], literal: true, next: start + 1}, nil
	}
	if sawClosing {
		return reading{}, &ParseError{Line: start + 1, Msg: "unexpected text after the closing quote"}
	}
	return reading{}, &ParseError{Line: start + 1, Msg: "quote never closed"}
}

// readings lists the ways to read the quoted value starting on line start, in line order.
// fallback reports whether that line on its own starts and ends with the quote; sawClosing
// whether a closing quote was found at all.
func (p *parser) readings(start int, first string) (readings []reading, fallback, sawClosing bool) {
	quote := first[0]
	firstLine := strings.TrimRight(first, " \r")
	fallback = len(firstLine) >= 2 && firstLine[len(firstLine)-1] == quote

	if quote == '\'' {
		// The server never writes single quotes, but writes a value that merely starts with
		// one as is ('abc123, 'it's). Read single-line values as earlier versions did.
		if at := strings.IndexByte(first[1:], '\''); at >= 0 {
			value := firstLine // as is, like 'it's
			if strings.TrimSpace(first[at+2:]) == "" {
				value = first[1 : at+1]
			} else if fallback {
				value = firstLine[1 : len(firstLine)-1]
			}
			return []reading{{value: value, literal: true, next: start + 1, closed: true}}, fallback, true
		}
		readings = append(readings, reading{value: firstLine, literal: true, next: start + 1})
	}

	segment := first[1:]
	for line := start; ; {
		p.scanned++
		if at := closingQuote(segment, quote); at >= 0 {
			if isBlankOrComment(segment[at+1:], quote) {
				readings = append(readings, reading{endLine: line, endAt: at, next: line + 1, closed: true})
			}
			return readings, fallback, true
		}
		// `\"` ending a line is an escaped quote, or a backslash that ends the value followed
		// by the closing quote: keep both readings.
		if quote == '"' && strings.HasSuffix(strings.TrimRight(segment, " \t\r"), `\"`) {
			readings = append(readings, reading{
				endLine: line,
				endAt:   strings.LastIndex(segment, `"`),
				next:    line + 1,
			})
		}
		line++
		if line >= len(p.lines) || p.scanned > maxScannedLines {
			return readings, fallback, false
		}
		segment = p.lines[line]
	}
}

// text builds the value of reading r of the quoted value starting on line start.
func (p *parser) text(start int, first string, r reading) string {
	if r.literal {
		return r.value
	}
	if r.endLine == start {
		return unescape(first[1:1+r.endAt], first[0])
	}
	var b strings.Builder
	b.WriteString(first[1:])
	for line := start + 1; line < r.endLine; line++ {
		b.WriteString("\n")
		b.WriteString(p.lines[line])
	}
	b.WriteString("\n")
	b.WriteString(p.lines[r.endLine][:r.endAt])
	return unescape(b.String(), first[0])
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

// splitAssignment splits a KEY=value line. value is the unquoted value (leading whitespace
// kept, trailing spaces and \r removed), or the raw text after "=" when quoted.
func splitAssignment(line string) (key, value string, quoted, ok bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false, false
	}
	eq := strings.Index(line, "=")
	if eq == -1 {
		return "", "", false, false
	}
	key = strings.TrimSpace(line[:eq])
	if key == "" {
		return "", "", false, false
	}
	value = line[eq+1:]
	if value != "" && (value[0] == '"' || value[0] == '\'') {
		return key, value, true, true
	}
	return key, strings.TrimRight(value, " \r"), false, true
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
