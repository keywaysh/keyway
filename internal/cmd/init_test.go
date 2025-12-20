package cmd

import (
	"testing"
)

func TestFormatCandidates_Empty(t *testing.T) {
	result := formatCandidates(nil)

	if result != "" {
		t.Errorf("formatCandidates(nil) = %q, want empty string", result)
	}
}

func TestFormatCandidates_Single(t *testing.T) {
	candidates := []envCandidate{
		{file: ".env", env: "development"},
	}

	result := formatCandidates(candidates)

	if result != ".env" {
		t.Errorf("formatCandidates() = %q, want \".env\"", result)
	}
}

func TestFormatCandidates_Multiple(t *testing.T) {
	candidates := []envCandidate{
		{file: ".env", env: "development"},
		{file: ".env.production", env: "production"},
		{file: ".env.staging", env: "staging"},
	}

	result := formatCandidates(candidates)

	expected := ".env, .env.production, .env.staging"
	if result != expected {
		t.Errorf("formatCandidates() = %q, want %q", result, expected)
	}
}

func TestFormatCandidates_OnlyProduction(t *testing.T) {
	candidates := []envCandidate{
		{file: ".env.production", env: "production"},
	}

	result := formatCandidates(candidates)

	if result != ".env.production" {
		t.Errorf("formatCandidates() = %q, want \".env.production\"", result)
	}
}

func TestFormatCandidates_VariousEnvFiles(t *testing.T) {
	candidates := []envCandidate{
		{file: ".env", env: "development"},
		{file: ".env.test", env: "test"},
		{file: ".env.development.local", env: "development.local"},
	}

	result := formatCandidates(candidates)

	expected := ".env, .env.test, .env.development.local"
	if result != expected {
		t.Errorf("formatCandidates() = %q, want %q", result, expected)
	}
}
