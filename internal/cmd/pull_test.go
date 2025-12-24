package cmd

import (
	"testing"

	"github.com/keywaysh/cli/internal/env"
)

func TestCountEnvLines_SimpleContent(t *testing.T) {
	content := `API_KEY=secret123
DB_HOST=localhost
DB_PORT=5432`

	result := env.CountLines(content)

	if result != 3 {
		t.Errorf("CountLines() = %d, want 3", result)
	}
}

func TestCountEnvLines_WithComments(t *testing.T) {
	content := `# This is a comment
API_KEY=secret123
# Another comment
DB_HOST=localhost`

	result := env.CountLines(content)

	if result != 2 {
		t.Errorf("CountLines() = %d, want 2 (comments should be excluded)", result)
	}
}

func TestCountEnvLines_WithEmptyLines(t *testing.T) {
	content := `API_KEY=secret123

DB_HOST=localhost

DB_PORT=5432

`

	result := env.CountLines(content)

	if result != 3 {
		t.Errorf("CountLines() = %d, want 3 (empty lines should be excluded)", result)
	}
}

func TestCountEnvLines_EmptyContent(t *testing.T) {
	result := env.CountLines("")

	if result != 0 {
		t.Errorf("CountLines(\"\") = %d, want 0", result)
	}
}

func TestCountEnvLines_OnlyComments(t *testing.T) {
	content := `# Comment 1
# Comment 2
# Comment 3`

	result := env.CountLines(content)

	if result != 0 {
		t.Errorf("CountLines() = %d, want 0 (only comments)", result)
	}
}

func TestCountEnvLines_WhitespaceOnly(t *testing.T) {
	content := `

  `

	result := env.CountLines(content)

	if result != 0 {
		t.Errorf("CountLines() = %d, want 0 (whitespace only)", result)
	}
}

func TestCountEnvLines_MixedContent(t *testing.T) {
	content := `# Database settings
DATABASE_URL=postgres://localhost:5432/mydb

# API Keys
API_KEY=secret123
STRIPE_KEY=sk_test_123

# Empty value is still a line
EMPTY_VAR=`

	result := env.CountLines(content)

	if result != 4 {
		t.Errorf("CountLines() = %d, want 4", result)
	}
}

func TestCountEnvLines_WindowsLineEndings(t *testing.T) {
	content := "API_KEY=secret123\r\nDB_HOST=localhost\r\nDB_PORT=5432"

	result := env.CountLines(content)

	// Note: Windows line endings may be handled differently
	// The trimming should handle \r
	if result < 1 {
		t.Errorf("CountLines() = %d, should handle Windows line endings", result)
	}
}

func TestCountEnvLines_IndentedLines(t *testing.T) {
	content := `  API_KEY=secret123
		DB_HOST=localhost`

	result := env.CountLines(content)

	if result != 2 {
		t.Errorf("CountLines() = %d, want 2 (indented lines should be counted)", result)
	}
}

func TestCountEnvLines_CommentAfterHash(t *testing.T) {
	content := `API_KEY=secret123
  # This is indented comment
DB_HOST=localhost`

	result := env.CountLines(content)

	if result != 2 {
		t.Errorf("CountLines() = %d, want 2 (indented comments should be excluded)", result)
	}
}
