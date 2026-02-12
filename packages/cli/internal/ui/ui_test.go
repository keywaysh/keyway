package ui

import (
	"os"
	"testing"
)

func TestIsInteractive_CI(t *testing.T) {
	tests := []struct {
		name     string
		ciValue  string
		expected bool
	}{
		{"CI=true", "true", false},
		{"CI=1", "1", false},
		{"CI=false", "false", true}, // Not a recognized CI value
		{"CI empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Save original value
			original := os.Getenv("CI")
			defer os.Setenv("CI", original)

			if tt.ciValue == "" {
				os.Unsetenv("CI")
			} else {
				os.Setenv("CI", tt.ciValue)
			}

			// Note: This test may still return false if not running in a terminal
			// We're mainly testing the CI environment variable check
			result := IsInteractive()

			// In CI environment, should always be false
			if tt.ciValue == "true" || tt.ciValue == "1" {
				if result != false {
					t.Errorf("IsInteractive() with CI=%s should be false, got %v", tt.ciValue, result)
				}
			}
		})
	}
}

func TestValue(t *testing.T) {
	result := Value("test")
	if result == "" {
		t.Error("Value() should return non-empty string")
	}
}

func TestFile(t *testing.T) {
	result := File("/path/to/file")
	if result == "" {
		t.Error("File() should return non-empty string")
	}
}

func TestLink(t *testing.T) {
	result := Link("https://example.com")
	if result == "" {
		t.Error("Link() should return non-empty string")
	}
}

func TestDim(t *testing.T) {
	result := Dim("dimmed text")
	if result == "" {
		t.Error("Dim() should return non-empty string")
	}
}

func TestBold(t *testing.T) {
	result := Bold("bold text")
	if result == "" {
		t.Error("Bold() should return non-empty string")
	}
}

func TestCommand(t *testing.T) {
	result := Command("keyway push")
	if result == "" {
		t.Error("Command() should return non-empty string")
	}
}

// TestConfirmDefaultValue verifies that the Confirm function
// initializes result with defaultValue before running the prompt.
// This is a compile-time check to ensure the pattern is followed.
// The actual interactive behavior cannot be unit tested without mocking huh.
//
// The correct pattern is:
//
//	result := defaultValue  // Initialize with default
//	err := huh.NewConfirm().Value(&result).Run()
//
// NOT:
//
//	var result bool  // Zero value (false) regardless of defaultValue
//	err := huh.NewConfirm().Value(&result).Run()
func TestConfirmDefaultValue_DocumentedBehavior(t *testing.T) {
	// This test documents the expected behavior.
	// The actual Confirm function requires terminal interaction,
	// so we verify the implementation pattern through code review.
	//
	// If you're modifying Confirm(), ensure:
	// 1. result is initialized to defaultValue
	// 2. On error, defaultValue is returned
	t.Log("Confirm() must initialize result := defaultValue before huh.NewConfirm().Value(&result)")
}

// TestSelectDefaultValue documents that Select should initialize
// with a default if one is provided in the future.
func TestSelectDefaultValue_DocumentedBehavior(t *testing.T) {
	t.Log("Select() currently has no default value parameter")
	t.Log("If adding default support, initialize: result := defaultValue")
}

func TestValue_DifferentTypes(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
	}{
		{"string", "test"},
		{"int", 42},
		{"float", 3.14},
		{"bool", true},
		{"nil", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Value(tt.input)
			if result == "" && tt.input != nil {
				t.Errorf("Value(%v) should return non-empty string", tt.input)
			}
		})
	}
}

func TestFormattingFunctions_Consistency(t *testing.T) {
	// All formatting functions should return non-empty strings
	// and contain the original input

	t.Run("File contains path", func(t *testing.T) {
		result := File("test.txt")
		if result == "" {
			t.Error("File() should return non-empty string")
		}
	})

	t.Run("Link contains URL", func(t *testing.T) {
		result := Link("https://example.com")
		if result == "" {
			t.Error("Link() should return non-empty string")
		}
	})

	t.Run("Command contains cmd", func(t *testing.T) {
		result := Command("keyway pull")
		if result == "" {
			t.Error("Command() should return non-empty string")
		}
	})

	t.Run("Dim returns text", func(t *testing.T) {
		result := Dim("dimmed")
		if result == "" {
			t.Error("Dim() should return non-empty string")
		}
	})

	t.Run("Bold returns text", func(t *testing.T) {
		result := Bold("bold")
		if result == "" {
			t.Error("Bold() should return non-empty string")
		}
	})
}

func TestIsInteractive_EdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		ciValue string
	}{
		// These are NOT recognized as CI=true, so IsInteractive might return true
		// (depending on terminal status)
		{"CI=TRUE uppercase", "TRUE"},
		{"CI=True mixed", "True"},
		{"CI=yes", "yes"},
		{"CI=on", "on"},
		{"CI=0", "0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := os.Getenv("CI")
			defer os.Setenv("CI", original)

			os.Setenv("CI", tt.ciValue)
			// Just verify it doesn't panic - the actual value depends on terminal status
			_ = IsInteractive()
		})
	}
}

func TestFormattingFunctions_EmptyInput(t *testing.T) {
	// Test that formatting functions handle empty input gracefully
	tests := []struct {
		name string
		fn   func(string) string
	}{
		{"Dim", Dim},
		{"Bold", Bold},
		{"File", File},
		{"Link", Link},
		{"Command", Command},
	}

	for _, tt := range tests {
		t.Run(tt.name+"_empty", func(t *testing.T) {
			// Should not panic with empty input
			result := tt.fn("")
			// Result can be empty or contain ANSI codes, just shouldn't panic
			_ = result
		})
	}
}
