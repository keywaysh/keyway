package cmd

import (
	"testing"
)

func TestTrimSpace(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", ""},
		{"hello", "hello"},
		{"  hello", "hello"},
		{"hello  ", "hello"},
		{"  hello  ", "hello"},
		{"\thello\t", "hello"},
		{"\nhello\n", "hello"},
		{"\r\nhello\r\n", "hello"},
		{"  \t\n  hello  \t\n  ", "hello"},
		{"   ", ""},
		{"\t\n\r", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := trimSpace(tt.input)
			if result != tt.expected {
				t.Errorf("trimSpace(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestHasPrefix(t *testing.T) {
	tests := []struct {
		s        string
		prefix   string
		expected bool
	}{
		{"github_pat_123", "github_pat_", true},
		{"github_pat_", "github_pat_", true},
		{"GITHUB_PAT_123", "github_pat_", false}, // case sensitive
		{"ghp_123", "github_pat_", false},
		{"", "github_pat_", false},
		{"github_pat_123", "", true},
		{"", "", true},
		{"short", "longerprefix", false},
	}

	for _, tt := range tests {
		name := tt.s + "_" + tt.prefix
		t.Run(name, func(t *testing.T) {
			result := hasPrefix(tt.s, tt.prefix)
			if result != tt.expected {
				t.Errorf("hasPrefix(%q, %q) = %v, want %v", tt.s, tt.prefix, result, tt.expected)
			}
		})
	}
}

func TestTrimSpace_Unicode(t *testing.T) {
	// Test that trimSpace handles various whitespace characters
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"leading space", " hello", "hello"},
		{"trailing space", "hello ", "hello"},
		{"both spaces", " hello ", "hello"},
		{"multiple leading", "   hello", "hello"},
		{"multiple trailing", "hello   ", "hello"},
		{"tabs", "\thello\t", "hello"},
		{"newlines", "\nhello\n", "hello"},
		{"carriage return", "\rhello\r", "hello"},
		{"mixed whitespace", " \t\n\rhello\r\n\t ", "hello"},
		{"only whitespace", "   ", ""},
		{"empty string", "", ""},
		{"no whitespace", "hello", "hello"},
		{"internal whitespace preserved", "hello world", "hello world"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := trimSpace(tt.input)
			if result != tt.expected {
				t.Errorf("trimSpace(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestHasPrefix_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		s        string
		prefix   string
		expected bool
	}{
		{"exact match", "abc", "abc", true},
		{"longer string", "abcdef", "abc", true},
		{"prefix longer", "ab", "abc", false},
		{"unicode prefix", "日本語", "日本", true},
		{"unicode no match", "日本語", "中国", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := hasPrefix(tt.s, tt.prefix)
			if result != tt.expected {
				t.Errorf("hasPrefix(%q, %q) = %v, want %v", tt.s, tt.prefix, result, tt.expected)
			}
		})
	}
}
