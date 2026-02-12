package env

import (
	"testing"
)

func TestParse_SimpleKeyValue(t *testing.T) {
	content := `API_KEY=secret123
DB_HOST=localhost
DB_PORT=5432`

	result := Parse(content)

	if len(result) != 3 {
		t.Errorf("expected 3 entries, got %d", len(result))
	}
	if result["API_KEY"] != "secret123" {
		t.Errorf("API_KEY = %q, want secret123", result["API_KEY"])
	}
	if result["DB_HOST"] != "localhost" {
		t.Errorf("DB_HOST = %q, want localhost", result["DB_HOST"])
	}
	if result["DB_PORT"] != "5432" {
		t.Errorf("DB_PORT = %q, want 5432", result["DB_PORT"])
	}
}

func TestParse_WithComments(t *testing.T) {
	content := `# This is a comment
API_KEY=secret123
# Another comment
DB_HOST=localhost`

	result := Parse(content)

	if len(result) != 2 {
		t.Errorf("expected 2 entries (comments ignored), got %d", len(result))
	}
	if result["API_KEY"] != "secret123" {
		t.Errorf("API_KEY = %q, want secret123", result["API_KEY"])
	}
}

func TestParse_WithEmptyLines(t *testing.T) {
	content := `API_KEY=secret123

DB_HOST=localhost

`

	result := Parse(content)

	if len(result) != 2 {
		t.Errorf("expected 2 entries (empty lines ignored), got %d", len(result))
	}
}

func TestParse_WithQuotedValues(t *testing.T) {
	content := `SINGLE_QUOTED='hello world'
DOUBLE_QUOTED="hello world"
UNQUOTED=hello world`

	result := Parse(content)

	if result["SINGLE_QUOTED"] != "hello world" {
		t.Errorf("SINGLE_QUOTED = %q, want 'hello world'", result["SINGLE_QUOTED"])
	}
	if result["DOUBLE_QUOTED"] != "hello world" {
		t.Errorf("DOUBLE_QUOTED = %q, want 'hello world'", result["DOUBLE_QUOTED"])
	}
	if result["UNQUOTED"] != "hello world" {
		t.Errorf("UNQUOTED = %q, want 'hello world'", result["UNQUOTED"])
	}
}

func TestParse_WithEqualsInValue(t *testing.T) {
	content := `DATABASE_URL=postgres://user:pass@host:5432/db?ssl=true
FORMULA=a=b+c`

	result := Parse(content)

	if result["DATABASE_URL"] != "postgres://user:pass@host:5432/db?ssl=true" {
		t.Errorf("DATABASE_URL = %q, want full URL", result["DATABASE_URL"])
	}
	if result["FORMULA"] != "a=b+c" {
		t.Errorf("FORMULA = %q, want a=b+c", result["FORMULA"])
	}
}

func TestParse_EmptyValue(t *testing.T) {
	content := `EMPTY_KEY=
ANOTHER_EMPTY=`

	result := Parse(content)

	if val, ok := result["EMPTY_KEY"]; !ok || val != "" {
		t.Errorf("EMPTY_KEY should exist with empty value, got %q, exists=%v", val, ok)
	}
}

func TestParse_NoEqualsSign(t *testing.T) {
	content := `VALID_KEY=value
INVALID_LINE_WITHOUT_EQUALS
ANOTHER_VALID=test`

	result := Parse(content)

	if len(result) != 2 {
		t.Errorf("expected 2 entries (invalid line ignored), got %d", len(result))
	}
	if _, exists := result["INVALID_LINE_WITHOUT_EQUALS"]; exists {
		t.Error("line without equals should be ignored")
	}
}

func TestParse_WhitespaceHandling(t *testing.T) {
	content := `  KEY_WITH_SPACES  =  value with spaces
	TABBED_KEY	=	tabbed value`

	result := Parse(content)

	// Keys should be trimmed, but leading whitespace in values is preserved
	// Note: lines are trimmed, so trailing whitespace is removed from values
	if result["KEY_WITH_SPACES"] != "  value with spaces" {
		t.Errorf("value leading whitespace should be preserved, got %q", result["KEY_WITH_SPACES"])
	}
	if result["TABBED_KEY"] != "\ttabbed value" {
		t.Errorf("value leading tab should be preserved, got %q", result["TABBED_KEY"])
	}
}

func TestParse_Empty(t *testing.T) {
	result := Parse("")

	if len(result) != 0 {
		t.Errorf("expected empty map for empty content, got %d entries", len(result))
	}
}

func TestParse_OnlyComments(t *testing.T) {
	content := `# Comment 1
# Comment 2
# Comment 3`

	result := Parse(content)

	if len(result) != 0 {
		t.Errorf("expected empty map for only comments, got %d entries", len(result))
	}
}

func TestParse_SpecialCharacters(t *testing.T) {
	content := `SPECIAL=!@#$%^&*()
JSON={"key": "value"}
URL=https://example.com?foo=bar&baz=qux`

	result := Parse(content)

	if result["SPECIAL"] != "!@#$%^&*()" {
		t.Errorf("SPECIAL = %q", result["SPECIAL"])
	}
	if result["JSON"] != `{"key": "value"}` {
		t.Errorf("JSON = %q", result["JSON"])
	}
	if result["URL"] != "https://example.com?foo=bar&baz=qux" {
		t.Errorf("URL = %q", result["URL"])
	}
}

func TestCountLines(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    int
	}{
		{"empty", "", 0},
		{"one line", "KEY=value", 1},
		{"with comments", "# comment\nKEY=value", 1},
		{"multiple", "A=1\nB=2\nC=3", 3},
		{"with empty lines", "A=1\n\nB=2\n\n", 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CountLines(tt.content)
			if got != tt.want {
				t.Errorf("CountLines() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestMerge_NoLocalOnly(t *testing.T) {
	vaultContent := "A=1\nB=2"
	local := map[string]string{"A": "1", "B": "2"}
	vault := map[string]string{"A": "1", "B": "2"}

	result := Merge(vaultContent, local, vault)

	// Should just return vault content with newline
	expected := "A=1\nB=2\n"
	if result != expected {
		t.Errorf("Merge() = %q, want %q", result, expected)
	}
}

func TestMerge_WithLocalOnly(t *testing.T) {
	vaultContent := "A=1"
	local := map[string]string{"A": "1", "LOCAL_SECRET": "my_value"}
	vault := map[string]string{"A": "1"}

	result := Merge(vaultContent, local, vault)

	// Should append local-only secrets
	if result != "A=1\n\n# Local variables (not in vault)\nLOCAL_SECRET=my_value\n" {
		t.Errorf("Merge() = %q", result)
	}
}

func TestMerge_MultipleLocalOnly(t *testing.T) {
	vaultContent := "SHARED=value"
	local := map[string]string{"SHARED": "value", "LOCAL_A": "a", "LOCAL_B": "b"}
	vault := map[string]string{"SHARED": "value"}

	result := Merge(vaultContent, local, vault)

	// Local-only should be sorted alphabetically
	expected := "SHARED=value\n\n# Local variables (not in vault)\nLOCAL_A=a\nLOCAL_B=b\n"
	if result != expected {
		t.Errorf("Merge() = %q, want %q", result, expected)
	}
}

func TestMerge_EmptyVault(t *testing.T) {
	vaultContent := ""
	local := map[string]string{"LOCAL": "secret"}
	vault := map[string]string{}

	result := Merge(vaultContent, local, vault)

	expected := "\n\n# Local variables (not in vault)\nLOCAL=secret\n"
	if result != expected {
		t.Errorf("Merge() = %q, want %q", result, expected)
	}
}

func TestMerge_PreservesVaultFormatting(t *testing.T) {
	vaultContent := "# Database config\nDB_HOST=localhost\n\n# API Keys\nAPI_KEY=secret"
	local := map[string]string{"DB_HOST": "localhost", "API_KEY": "secret"}
	vault := map[string]string{"DB_HOST": "localhost", "API_KEY": "secret"}

	result := Merge(vaultContent, local, vault)

	// Should preserve vault formatting (comments, blank lines)
	expected := "# Database config\nDB_HOST=localhost\n\n# API Keys\nAPI_KEY=secret\n"
	if result != expected {
		t.Errorf("Merge() = %q, want %q", result, expected)
	}
}
