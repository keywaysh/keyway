package env

import (
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestParse_MultiLineDoubleQuotedValue(t *testing.T) {
	result := mustParse(t, "A=\"line1\nline2\nline3\"\nB=after")

	if result["A"] != "line1\nline2\nline3" {
		t.Errorf("A = %q, want the three lines", result["A"])
	}
	if result["B"] != "after" {
		t.Errorf("B = %q, want after", result["B"])
	}
}

func TestParse_MultiLineSingleQuotedValue(t *testing.T) {
	result := mustParse(t, "A='line1\nline2'\nB=after")

	if result["A"] != "line1\nline2" {
		t.Errorf("A = %q, want the two lines", result["A"])
	}
	if result["B"] != "after" {
		t.Errorf("B = %q, want after", result["B"])
	}
}

func TestParse_UnescapesQuotesInsideDoubleQuotes(t *testing.T) {
	result := mustParse(t, `GREETING="say \"hi\""`)

	if result["GREETING"] != `say "hi"` {
		t.Errorf("GREETING = %q, want say \"hi\"", result["GREETING"])
	}
}

func TestParse_KeepsOtherBackslashes(t *testing.T) {
	// Only \" is an escape: \n stays a backslash and an n, as the server writes it.
	result := mustParse(t, `PEM_ONE_LINE="a\nb c"`)

	if result["PEM_ONE_LINE"] != `a\nb c` {
		t.Errorf("PEM_ONE_LINE = %q, want a literal backslash-n", result["PEM_ONE_LINE"])
	}
}

func TestParse_KeepsWhitespaceInsideQuotes(t *testing.T) {
	result := mustParse(t, "A=\"first  \n  second\"\nB=\"  padded  \"")

	if result["A"] != "first  \n  second" {
		t.Errorf("A = %q, want the spaces kept", result["A"])
	}
	if result["B"] != "  padded  " {
		t.Errorf("B = %q, want the spaces kept", result["B"])
	}
}

func TestParse_CommentAfterClosingQuote(t *testing.T) {
	result := mustParse(t, `A="value" # note`)

	if result["A"] != "value" {
		t.Errorf("A = %q, want value", result["A"])
	}
}

func TestParse_StripsByteOrderMark(t *testing.T) {
	result := mustParse(t, "\uFEFFFIRST=1\nSECOND=2")

	if result["FIRST"] != "1" {
		t.Errorf("FIRST = %q, want 1 (keys: %v)", result["FIRST"], result)
	}
}

func TestParse_CRLFLineEndings(t *testing.T) {
	result := mustParse(t, "A=1\r\nB=\"two words\"\r\nC='x'\r\n")

	if result["A"] != "1" || result["B"] != "two words" || result["C"] != "x" {
		t.Errorf("got %q", result)
	}
}

func TestParse_ValueEndingWithBackslash(t *testing.T) {
	// The server writes "ends with \" for a quoted value ending with a backslash.
	result := mustParse(t, "A=\"ends with \\\"\nB=\"x \\\"y\\\"\"")

	if result["A"] != `ends with \` {
		t.Errorf("A = %q, want ends with a backslash", result["A"])
	}
	if result["B"] != `x "y"` {
		t.Errorf("B = %q, want x \"y\"", result["B"])
	}
}

func TestParse_FirstLineEndingWithQuote(t *testing.T) {
	result := mustParse(t, "NOTE=\"title: \\\"Hello\\\"\nbody: x\"")

	if result["NOTE"] != "title: \"Hello\"\nbody: x" {
		t.Errorf("NOTE = %q, want both lines", result["NOTE"])
	}
}

func TestParse_HandWrittenQuotesKeepTheirMeaning(t *testing.T) {
	// Single-line values 0.6.0 read the same way stay the same.
	result := mustParse(t, "A=\"say \"hi\"\"\nB='it'\nC='abc123\nD=it's")

	want := map[string]string{"A": `say "hi"`, "B": "it", "C": "'abc123", "D": "it's"}
	if got := mustParse(t, "E='it's\nF='x'y\nG='x'\t"); got["E"] != "'it's" || got["F"] != "'x'y" || got["G"] != "x" {
		t.Errorf("values starting with a quote: got %q", got)
	}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestParse_RefusesUnterminatedDoubleQuote(t *testing.T) {
	// 0.6.0 kept `"first line` and pushed it, cutting the value at its first line.
	_, err := Parse("OK=1\nA=\"first line\nsecond line\nB=2")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected a ParseError, got %v", err)
	}
	if parseErr.Line != 2 {
		t.Errorf("error on line %d, want 2: %v", parseErr.Line, err)
	}
}

func TestParse_RefusesTextAfterClosingQuote(t *testing.T) {
	_, err := Parse(`A="value" trailing`)

	var parseErr *ParseError
	if !errors.As(err, &parseErr) || parseErr.Line != 1 {
		t.Fatalf("expected a ParseError on line 1, got %v", err)
	}
}

func TestParse_PicksTheOnlyReadingThatHolds(t *testing.T) {
	// `\"` at the end of line 1 is either an escaped quote or a backslash and the closing
	// quote. Only the second leaves valid lines behind.
	result := mustParse(t, "A=\"a b\\\"\nC=\"\nc\"")

	want := map[string]string{"A": `a b\`, "C": "\nc"}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestParse_RefusesAmbiguousContent(t *testing.T) {
	// Read as {A: `a b\`, C: "\nD=1"} or as {A: "a b\"\nC=", D: `1"`}: never guess.
	_, err := Parse("A=\"a b\\\"\nC=\"\nD=1\"")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) || parseErr.Line != 1 {
		t.Fatalf("expected a ParseError on line 1, got %v", err)
	}
}

func TestFormatLine_MatchesTheServerFormat(t *testing.T) {
	tests := map[string]string{
		"plain":      "K=plain",
		"two words":  `K="two words"`,
		`say "hi"`:   `K="say \"hi\""`,
		"a\nb":       "K=\"a\nb\"",
		"":           "K=",
		`ends\`:      `K=ends\`,
		"'single'":   "K='single'",
		"tab\there":  "K=tab\there",
		"#not a cmt": `K="#not a cmt"`,
	}
	for value, want := range tests {
		if got := FormatLine("K", value); got != want {
			t.Errorf("FormatLine(%q) = %q, want %q", value, got, want)
		}
	}
}

// Values the server wrote are read back exactly, or refused; never read as something else.
func TestParse_ReadsBackWhatTheServerWrites(t *testing.T) {
	data, err := os.ReadFile("testdata/toenvformat.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Values  map[string]string `json:"values"`
			Order   []string          `json:"order"`
			Content string            `json:"content"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) < 20 {
		t.Fatalf("expected the recorded cases, got %d", len(fixture.Cases))
	}

	for _, c := range fixture.Cases {
		lines := make([]string, 0, len(c.Order))
		for _, key := range c.Order {
			lines = append(lines, FormatLine(key, c.Values[key]))
		}
		if formatted := strings.Join(lines, "\n"); formatted != c.Content {
			t.Errorf("FormatLine differs from the server:\n got %q\nwant %q", formatted, c.Content)
		}

		got, err := Parse(c.Content)
		if err != nil {
			continue // refused: allowed, checked below for the plain cases
		}
		if !reflect.DeepEqual(got, c.Values) {
			t.Errorf("Parse(%q)\n got %q\nwant %q", c.Content, got, c.Values)
		}
	}

	// Each value on its own is always read back.
	for _, c := range fixture.Cases {
		if len(c.Values) != 1 {
			continue
		}
		if _, err := Parse(c.Content); err != nil {
			t.Errorf("Parse(%q) refused a lone value: %v", c.Content, err)
		}
	}
}

// Over random secrets, reading back what FormatLine wrote gives the secrets or an error.
func TestParse_RoundTripProperty(t *testing.T) {
	rng := rand.New(rand.NewSource(20261024))
	pieces := []string{"a", "Z9", " ", "\n", `"`, "'", `\`, "=", "#", "\t", "é", "x=y", `\"`, "\n\n"}
	keys := []string{"A", "B", "C_1", "DB_URL", "lower", "_X"}
	refused := 0
	const runs = 20000

	for i := 0; i < runs; i++ {
		secrets := map[string]string{}
		for _, key := range keys[:1+rng.Intn(len(keys))] {
			var b strings.Builder
			for n := rng.Intn(6); n > 0; n-- {
				b.WriteString(pieces[rng.Intn(len(pieces))])
			}
			value := b.String()
			if !carriedByFormat(value) {
				continue
			}
			secrets[key] = value
		}
		order := make([]string, 0, len(secrets))
		for key := range secrets {
			order = append(order, key)
		}
		sort.Strings(order)
		rng.Shuffle(len(order), func(a, b int) { order[a], order[b] = order[b], order[a] })
		lines := make([]string, 0, len(order))
		for _, key := range order {
			lines = append(lines, FormatLine(key, secrets[key]))
		}
		content := strings.Join(lines, "\n")

		got, err := Parse(content)
		if err != nil {
			refused++
			continue
		}
		if !reflect.DeepEqual(got, secrets) {
			t.Fatalf("Parse(%q)\n got %q\nwant %q", content, got, secrets)
		}
	}
	// Refusals only come from values the format cannot tell apart: they must stay rare.
	if refused > runs/10 {
		t.Errorf("refused %d of %d contents", refused, runs)
	}
}

func FuzzParse_NeverReadsBackSomethingElse(f *testing.F) {
	f.Add("value-1", "line1\nline2")
	f.Add(`ends with \`, "\nstarts on line two")
	f.Add(`say "hi"`, `title: "Hello"`+"\nbody: x")
	f.Add("'abc123", "a\\\"\nB=1")
	f.Fuzz(func(t *testing.T, a, b string) {
		if !carriedByFormat(a) || !carriedByFormat(b) {
			return
		}
		secrets := map[string]string{"A": a, "B": b}
		content := FormatLine("A", a) + "\n" + FormatLine("B", b)
		got, err := Parse(content)
		if err == nil && !reflect.DeepEqual(got, secrets) {
			t.Fatalf("Parse(%q)\n got %q\nwant %q", content, got, secrets)
		}
	})
}

// carriedByFormat reports whether the server's .env format can carry value exactly. It cannot
// tell an unquoted value ending with \r from a CRLF line end, nor one wrapped in single quotes
// ('x') from a hand-quoted one; a leading byte order mark reads as the file's.
func carriedByFormat(value string) bool {
	if strings.HasPrefix(value, "\uFEFF") {
		return false
	}
	if strings.ContainsAny(value, " \n\"") {
		return true // quoted
	}
	if strings.HasSuffix(value, "\r") {
		return false
	}
	if value == "" || value[0] != '\'' {
		return true
	}
	// Starts with a single quote: carried unless it reads as single-quoted
	at := strings.IndexByte(value[1:], '\'')
	wrapped := len(value) >= 2 && value[len(value)-1] == '\''
	return at < 0 || (strings.TrimSpace(value[at+2:]) != "" && !wrapped)
}

func FuzzParse_NoPanic(f *testing.F) {
	f.Add("A=1\nB=\"x\ny\"\n# c\nC='z'")
	f.Add("A=\"a\\\"\nB=\"\nc\"")
	f.Fuzz(func(t *testing.T, content string) {
		result, err := Parse(content)
		if err == nil {
			for key := range result {
				if key == "" {
					t.Fatalf("empty key from %q", content)
				}
			}
		}
	})
}

func TestMerge_QuotesLocalOnlyValues(t *testing.T) {
	local := map[string]string{"A": "1", "LOCAL": "two words\nand a line", "QUOTE": `a "b"`}
	vault := map[string]string{"A": "1"}

	result := Merge("A=1", local, vault)

	if got := mustParse(t, result); !reflect.DeepEqual(got, local) {
		t.Errorf("Parse(Merge(...)) = %q, want %q", got, local)
	}
}

// Readings of ambiguous lines are told apart in linear time, whatever the content.
func TestParse_StaysFastOnAdversarialContent(t *testing.T) {
	contents := map[string]string{
		"every line ends with an escaped quote": "K=\"" + strings.Repeat("line \\\"\n", 50000) + "end\"",
		"many short ambiguous values":           strings.Repeat("K=\"x \\\"\n", 50000),
		"assignments inside one value":          "K=\"" + strings.Repeat("X=1 \\\"\n", 50000) + "end\"",
		"unclosed single quotes":                strings.Repeat("A='x\n", 20000) + strings.Repeat("y\n", 20000),
	}
	for name, content := range contents {
		start := time.Now()
		_, _ = Parse(content)
		if elapsed := time.Since(start); elapsed > 2*time.Second {
			t.Errorf("%s: took %v", name, elapsed)
		}
	}
}
