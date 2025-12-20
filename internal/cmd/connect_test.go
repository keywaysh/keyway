package cmd

import (
	"testing"
)

func TestIsTokenAuthProvider(t *testing.T) {
	tests := []struct {
		provider string
		expected bool
	}{
		{"railway", true},
		{"Railway", true},
		{"RAILWAY", true},
		{"vercel", false},
		{"Vercel", false},
		{"VERCEL", false},
		{"netlify", false},
		{"unknown", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			result := isTokenAuthProvider(tt.provider)
			if result != tt.expected {
				t.Errorf("isTokenAuthProvider(%q) = %v, want %v", tt.provider, result, tt.expected)
			}
		})
	}
}

func TestGetTokenCreationURL(t *testing.T) {
	tests := []struct {
		provider string
		expected string
	}{
		{"railway", "https://railway.com/account/tokens"},
		{"Railway", "https://railway.com/account/tokens"},
		{"RAILWAY", "https://railway.com/account/tokens"},
		{"vercel", ""},
		{"unknown", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			result := getTokenCreationURL(tt.provider)
			if result != tt.expected {
				t.Errorf("getTokenCreationURL(%q) = %q, want %q", tt.provider, result, tt.expected)
			}
		})
	}
}
