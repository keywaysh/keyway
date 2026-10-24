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

func TestParse_RefusesWhenTheWorkBudgetRunsOut(t *testing.T) {
	// Telling the readings apart needs more work than allowed: refuse, never pick one.
	content := "S=\"a \\\"\nP = 1\nM='\n" + strings.Repeat("c\n", 3_000_000) + "x'\nZ=1\" #c"

	_, err := Parse(content)

	var parseErr *ParseError
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected a ParseError, got %v", err)
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
