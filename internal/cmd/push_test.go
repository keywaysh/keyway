package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseEnvContent_SimpleKeyValue(t *testing.T) {
	content := `API_KEY=secret123
DB_HOST=localhost
DB_PORT=5432`

	result := parseEnvContent(content)

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

func TestParseEnvContent_WithComments(t *testing.T) {
	content := `# This is a comment
API_KEY=secret123
# Another comment
DB_HOST=localhost`

	result := parseEnvContent(content)

	if len(result) != 2 {
		t.Errorf("expected 2 entries (comments ignored), got %d", len(result))
	}
	if result["API_KEY"] != "secret123" {
		t.Errorf("API_KEY = %q, want secret123", result["API_KEY"])
	}
}

func TestParseEnvContent_WithEmptyLines(t *testing.T) {
	content := `API_KEY=secret123

DB_HOST=localhost

`

	result := parseEnvContent(content)

	if len(result) != 2 {
		t.Errorf("expected 2 entries (empty lines ignored), got %d", len(result))
	}
}

func TestParseEnvContent_WithQuotedValues(t *testing.T) {
	content := `SINGLE_QUOTED='hello world'
DOUBLE_QUOTED="hello world"
UNQUOTED=hello world`

	result := parseEnvContent(content)

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

func TestParseEnvContent_WithEqualsInValue(t *testing.T) {
	content := `DATABASE_URL=postgres://user:pass@host:5432/db?ssl=true
FORMULA=a=b+c`

	result := parseEnvContent(content)

	if result["DATABASE_URL"] != "postgres://user:pass@host:5432/db?ssl=true" {
		t.Errorf("DATABASE_URL = %q, want full URL", result["DATABASE_URL"])
	}
	if result["FORMULA"] != "a=b+c" {
		t.Errorf("FORMULA = %q, want a=b+c", result["FORMULA"])
	}
}

func TestParseEnvContent_EmptyValue(t *testing.T) {
	content := `EMPTY_KEY=
ANOTHER_EMPTY=`

	result := parseEnvContent(content)

	if val, ok := result["EMPTY_KEY"]; !ok || val != "" {
		t.Errorf("EMPTY_KEY should exist with empty value, got %q, exists=%v", val, ok)
	}
}

func TestParseEnvContent_NoEqualsSign(t *testing.T) {
	content := `VALID_KEY=value
INVALID_LINE_WITHOUT_EQUALS
ANOTHER_VALID=test`

	result := parseEnvContent(content)

	if len(result) != 2 {
		t.Errorf("expected 2 entries (invalid line ignored), got %d", len(result))
	}
	if _, exists := result["INVALID_LINE_WITHOUT_EQUALS"]; exists {
		t.Error("line without equals should be ignored")
	}
}

func TestParseEnvContent_WhitespaceHandling(t *testing.T) {
	content := `  KEY_WITH_SPACES  =  value with spaces
	TABBED_KEY	=	tabbed value`

	result := parseEnvContent(content)

	// Keys should be trimmed, but leading whitespace in values is preserved
	// Note: lines are trimmed, so trailing whitespace is removed from values
	if result["KEY_WITH_SPACES"] != "  value with spaces" {
		t.Errorf("value leading whitespace should be preserved, got %q", result["KEY_WITH_SPACES"])
	}
	if result["TABBED_KEY"] != "\ttabbed value" {
		t.Errorf("value leading tab should be preserved, got %q", result["TABBED_KEY"])
	}
}

func TestParseEnvContent_Empty(t *testing.T) {
	result := parseEnvContent("")

	if len(result) != 0 {
		t.Errorf("expected empty map for empty content, got %d entries", len(result))
	}
}

func TestParseEnvContent_OnlyComments(t *testing.T) {
	content := `# Comment 1
# Comment 2
# Comment 3`

	result := parseEnvContent(content)

	if len(result) != 0 {
		t.Errorf("expected empty map for only comments, got %d entries", len(result))
	}
}

func TestParseEnvContent_SpecialCharacters(t *testing.T) {
	content := `SPECIAL=!@#$%^&*()
JSON={"key": "value"}
URL=https://example.com?foo=bar&baz=qux`

	result := parseEnvContent(content)

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

func TestDeriveEnvFromFile_DotEnv(t *testing.T) {
	tests := []struct {
		file     string
		expected string
	}{
		{".env", "development"},
		{".env.local", "local"},
		{".env.development", "development"},
		{".env.production", "production"},
		{".env.staging", "staging"},
		{".env.test", "test"},
		{".env.custom", "custom"},
		{"path/to/.env", "development"},
		{"path/to/.env.production", "production"},
	}

	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			result := deriveEnvFromFile(tt.file)
			if result != tt.expected {
				t.Errorf("deriveEnvFromFile(%q) = %q, want %q", tt.file, result, tt.expected)
			}
		})
	}
}

func TestDiscoverEnvFiles(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test files
	testFiles := []string{".env", ".env.production", ".env.staging", "not-env.txt"}
	for _, f := range testFiles {
		path := filepath.Join(tmpDir, f)
		if err := os.WriteFile(path, []byte("TEST=value"), 0644); err != nil {
			t.Fatalf("failed to create %s: %v", f, err)
		}
	}

	// Change to temp directory
	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := discoverEnvFiles()

	// Should find .env files but not .env.local or non-env files
	if len(candidates) != 3 {
		t.Errorf("expected 3 env files, got %d: %v", len(candidates), candidates)
	}

	// Check that files are correctly identified
	foundEnv := false
	foundProd := false
	foundStaging := false
	for _, c := range candidates {
		switch c.file {
		case ".env":
			foundEnv = true
			if c.env != "development" {
				t.Errorf(".env should map to development, got %q", c.env)
			}
		case ".env.production":
			foundProd = true
			if c.env != "production" {
				t.Errorf(".env.production should map to production, got %q", c.env)
			}
		case ".env.staging":
			foundStaging = true
			if c.env != "staging" {
				t.Errorf(".env.staging should map to staging, got %q", c.env)
			}
		}
	}

	if !foundEnv {
		t.Error("should find .env")
	}
	if !foundProd {
		t.Error("should find .env.production")
	}
	if !foundStaging {
		t.Error("should find .env.staging")
	}
}

func TestDiscoverEnvFiles_ExcludesEnvLocal(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .env.local (should be excluded)
	os.WriteFile(filepath.Join(tmpDir, ".env.local"), []byte("TEST=value"), 0644)
	os.WriteFile(filepath.Join(tmpDir, ".env"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := discoverEnvFiles()

	for _, c := range candidates {
		if c.file == ".env.local" {
			t.Error(".env.local should be excluded from discovery")
		}
	}
}

func TestDiscoverEnvFiles_EmptyDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := discoverEnvFiles()

	if len(candidates) != 0 {
		t.Errorf("expected 0 candidates in empty dir, got %d", len(candidates))
	}
}
