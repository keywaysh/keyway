package env

import (
	"errors"
	"reflect"
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

func TestParse_ReadsTheServersOutputWithSingleQuotes(t *testing.T) {
	// 'abc and xyz' are values the server writes unquoted; no multi-line single-quoted value
	// spans them.
	result := mustParse(t, "A='abc\nB=xyz'")

	if !reflect.DeepEqual(result, map[string]string{"A": "'abc", "B": "xyz'"}) {
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
