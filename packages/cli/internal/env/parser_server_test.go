package env

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func mustParseServer(t *testing.T, content string) map[string]string {
	t.Helper()
	result, err := ParseServer(content)
	if err != nil {
		t.Fatalf("ParseServer(%q) error: %v", content, err)
	}
	return result
}

func TestParseServer_ReadsWhatAFileWouldAlter(t *testing.T) {
	// The server never writes single quotes and ends lines with \n only: these are literal.
	result := mustParseServer(t, "W='x'\nCR=a\r\nSQ='abc\nEQ=xyz'\nTAB=a\t")

	want := map[string]string{"W": "'x'", "CR": "a\r", "SQ": "'abc", "EQ": "xyz'", "TAB": "a\t"}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestParseServer_ReadsQuotedValues(t *testing.T) {
	result := mustParseServer(t, "MULTI=\"line1\nline2\"\nQ=\"say \\\"hi\\\"\"\nTRAIL=\"C:\\Program Files\\\"\nN=\"\nstarts on line two\"")

	want := map[string]string{
		"MULTI": "line1\nline2",
		"Q":     `say "hi"`,
		"TRAIL": `C:\Program Files\`,
		"N":     "\nstarts on line two",
	}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestParseServer_ToleratesAFinalNewline(t *testing.T) {
	result := mustParseServer(t, "A=1\nB=\"two words\"\n")

	if !reflect.DeepEqual(result, map[string]string{"A": "1", "B": "two words"}) {
		t.Errorf("got %q", result)
	}
}

func TestParseServer_RefusesTextTheServerDoesNotWrite(t *testing.T) {
	for _, content := range []string{
		"A=two words",    // a space forces quotes
		"# comment\nA=1", // no comments
		"A=1\n\nB=2",     // no blank lines between entries
		"A=\"x\" # c",    // nothing after a closing quote
		"A=\"plain\"",    // quotes only when needed
		"A=\"never closed\nB=2",
	} {
		_, err := ParseServer(content)
		var parseErr *ParseError
		if !errors.As(err, &parseErr) {
			t.Errorf("ParseServer(%q) = %v, want a ParseError", content, err)
		}
	}
}

func TestParse_RefusesSingleQuotesThatReadTwoWays(t *testing.T) {
	// The server writes {A: "'abc", B: "xyz'"} this way, and so does a person for the
	// two-line value "abc\nB=xyz": refuse rather than pick one.
	_, err := Parse("A='abc\nB=xyz'")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) || parseErr.Line != 1 {
		t.Fatalf("expected a ParseError on line 1, got %v", err)
	}
}

func TestParse_HandWrittenSingleQuotedValueOverSeveralLines(t *testing.T) {
	// Base64 lines hold no "=" except as padding at the end: only the multi-line reading
	// leaves valid lines.
	content := "KEY='Zm9vYmFyYmF6\nYmF6cXV4Zm9v\ncXV4Zm9vYmFy=='\nNEXT=1"
	result := mustParse(t, content)

	want := map[string]string{"KEY": "Zm9vYmFyYmF6\nYmF6cXV4Zm9v\ncXV4Zm9vYmFy==", "NEXT": "1"}
	if !reflect.DeepEqual(result, want) {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestParse_NeverCutsATwoLineSingleQuotedValue(t *testing.T) {
	// Its second line looks like KEY=...': it could be the server's B=...' line. Never read
	// it as a one-line value plus a new key.
	_, err := Parse("KEY='Zm9vYmFyYmF6\nYmF6cXV4Zm9v=='")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected a ParseError, got %v", err)
	}
}

func TestParse_ReadsPulledTextWithACommentLikeLineInsideAValue(t *testing.T) {
	// From the server: C:\Program Files\ then a value starting on its second line whose next
	// line starts with #. Its text is unambiguous; a comment line must not make it ambiguous.
	secrets := map[string]string{"WIN_PATH": `C:\Program Files\`, "SCRIPT": "\n# only a comment"}
	content := FormatLine("WIN_PATH", secrets["WIN_PATH"]) + "\n" + FormatLine("SCRIPT", secrets["SCRIPT"])

	if got := mustParse(t, content); !reflect.DeepEqual(got, secrets) {
		t.Errorf("got %q, want %q", got, secrets)
	}
}

func TestParse_ReadsCRLFFilesAsTheirValues(t *testing.T) {
	// An editor converted the pulled file to CRLF: multi-line values keep \n line breaks.
	result := mustParse(t, "PEM=\"line one\r\nline two\"\r\nNEXT=1\r\n")

	if result["PEM"] != "line one\nline two" || result["NEXT"] != "1" {
		t.Errorf("got %q", result)
	}
}

func TestParseServer_KeepsALeadingByteOrderMark(t *testing.T) {
	// The server never writes one: it belongs to the first key.
	result := mustParseServer(t, "\uFEFFK=1")

	if result["\uFEFFK"] != "1" {
		t.Errorf("got %q", result)
	}
}

func TestParse_PrefersTheReadingTheServerWouldWrite(t *testing.T) {
	// `\"` ends line 1: a value ending with a backslash would not be quoted (no space), so the
	// quote is escaped and the value goes on.
	content := FormatLine("MSG", "hello\"\nfoo=\"bar")

	result := mustParse(t, content)

	if result["MSG"] != "hello\"\nfoo=\"bar" {
		t.Errorf("MSG = %q", result["MSG"])
	}
	if got, ok := ReadBack("MSG", "hello\"\nfoo=\"bar"); !ok || got != "hello\"\nfoo=\"bar" {
		t.Errorf("ReadBack = %q, %v", got, ok)
	}
}

func TestParse_RefusesWhenNoReadingHolds(t *testing.T) {
	// Neither "A ends on line 1" nor "A ends on line 2" leaves valid lines behind: refuse
	// rather than pick one.
	_, err := Parse("A=\"a \\\"\nB=b\"\nC=\"say \"hi\"\"\n\"stray")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) || parseErr.Line != 1 {
		t.Fatalf("expected a ParseError on line 1, got %v", err)
	}
}

func TestParseServer_RefusesAKeyOnTwoLines(t *testing.T) {
	// The server writes each key once. Twice means a stored key holds "=" or a line break
	// ({"TOKEN_KEY": "1", "TOKEN_KEY=TAIL": "2"}): refuse rather than keep either value, and
	// keep the key out of the message.
	_, err := ParseServer("TOKEN_KEY=1\nTOKEN_KEY=TAIL=2")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) || parseErr.Line != 2 {
		t.Fatalf("expected a ParseError on line 2, got %v", err)
	}
	if strings.Contains(err.Error(), "TOKEN_KEY") {
		t.Errorf("the message names the key: %v", err)
	}
}

func TestParse_SaysWhenAQuoteNeverClosesBeforeTheNextKey(t *testing.T) {
	// The quote found on line 2 opens B's value; it does not close A's.
	_, err := Parse("A=\"hello\nB=\"world\"")

	var parseErr *ParseError
	if !errors.As(err, &parseErr) || parseErr.Line != 1 || parseErr.Msg != "quote never closed" {
		t.Fatalf("expected \"quote never closed\" on line 1, got %v", err)
	}
}

func TestParse_RefusesPastTheWorkBudget(t *testing.T) {
	for name, content := range map[string]string{
		// Every line ends with \": each one is a place where the value may end
		"many places to end": "K=\"" + strings.Repeat("line \\\"\n", 100) + "end\"",
		// Its closing quote lies past the budget
		"one long value": "K=\"" + strings.Repeat("x\n", 1000) + "end\"",
		// K reads two ways; telling them apart means reading M, which runs past the budget
		"a long value after an ambiguous one": "K=\"a \\\"\nb\"\nM=\"" + strings.Repeat("x\n", 100) + "\"",
	} {
		if _, err := Parse(content); err != nil {
			t.Fatalf("%s: within the budget, error %v", name, err)
		}

		func() {
			defer func(budget int) { maxScannedLines = budget }(maxScannedLines)
			maxScannedLines = 50
			p := newParser(content)
			_, err := p.parse(lenient)

			var parseErr *ParseError
			if !errors.As(err, &parseErr) || parseErr.Msg != "too complex to read safely" {
				t.Errorf("%s: expected \"too complex to read safely\", got %v", name, err)
			}
			// The budget bounds the work, not only the outcome
			if p.scanned > 2*maxScannedLines {
				t.Errorf("%s: scanned %d lines", name, p.scanned)
			}
		}()
	}
}
