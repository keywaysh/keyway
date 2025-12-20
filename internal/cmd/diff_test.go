package cmd

import (
	"testing"
)

func TestNormalizeEnvName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"prod", "production"},
		{"PROD", "production"},
		{"Prod", "production"},
		{"production", "production"},
		{"dev", "development"},
		{"DEV", "development"},
		{"development", "development"},
		{"stg", "staging"},
		{"STG", "staging"},
		{"staging", "staging"},
		{"custom", "custom"},
		{"CUSTOM", "custom"},
		{"  prod  ", "production"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizeEnvName(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeEnvName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestPreviewValue(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", "(empty)"},
		{"a", "**a (1 chars)"},
		{"ab", "**ab (2 chars)"},
		{"abc", "**bc (3 chars)"},
		{"secret123", "**23 (9 chars)"},
		{"sk_live_abc123xyz", "**yz (17 chars)"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := previewValue(tt.input)
			if result != tt.expected {
				t.Errorf("previewValue(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}

	// Different values with different endings should produce different previews
	preview1 := previewValue("value1")
	preview2 := previewValue("value2")
	if preview1 == preview2 {
		t.Errorf("Different values produced same preview: %q", preview1)
	}
}

func TestMaskValue(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", "****"},
		{"a", "****"},
		{"ab", "****"},
		{"abc", "****"},
		{"abcd", "****"},
		{"abcde", "ab*de"},
		{"abcdef", "ab**ef"},
		{"secret123", "se*****23"},
		{"verylongsecretvalue", "ve***************ue"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := maskValue(tt.input)
			if result != tt.expected {
				t.Errorf("maskValue(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestCompareSecrets_EmptyMaps(t *testing.T) {
	secrets1 := map[string]string{}
	secrets2 := map[string]string{}

	result := compareSecrets("env1", "env2", secrets1, secrets2, false)

	if result.Env1 != "env1" || result.Env2 != "env2" {
		t.Errorf("Env names not set correctly")
	}
	if len(result.OnlyInEnv1) != 0 {
		t.Errorf("OnlyInEnv1 should be empty, got %v", result.OnlyInEnv1)
	}
	if len(result.OnlyInEnv2) != 0 {
		t.Errorf("OnlyInEnv2 should be empty, got %v", result.OnlyInEnv2)
	}
	if len(result.Different) != 0 {
		t.Errorf("Different should be empty, got %v", result.Different)
	}
	if len(result.Same) != 0 {
		t.Errorf("Same should be empty, got %v", result.Same)
	}
}

func TestCompareSecrets_IdenticalMaps(t *testing.T) {
	secrets1 := map[string]string{
		"API_KEY":     "secret123",
		"DB_PASSWORD": "dbpass",
	}
	secrets2 := map[string]string{
		"API_KEY":     "secret123",
		"DB_PASSWORD": "dbpass",
	}

	result := compareSecrets("production", "staging", secrets1, secrets2, false)

	if len(result.OnlyInEnv1) != 0 {
		t.Errorf("OnlyInEnv1 should be empty, got %v", result.OnlyInEnv1)
	}
	if len(result.OnlyInEnv2) != 0 {
		t.Errorf("OnlyInEnv2 should be empty, got %v", result.OnlyInEnv2)
	}
	if len(result.Different) != 0 {
		t.Errorf("Different should be empty, got %v", result.Different)
	}
	if len(result.Same) != 2 {
		t.Errorf("Same should have 2 items, got %d", len(result.Same))
	}
	if result.Stats.Same != 2 {
		t.Errorf("Stats.Same = %d, want 2", result.Stats.Same)
	}
}

func TestCompareSecrets_OnlyInEnv1(t *testing.T) {
	secrets1 := map[string]string{
		"API_KEY":    "secret123",
		"EXTRA_KEY":  "extra",
		"ANOTHER":    "value",
	}
	secrets2 := map[string]string{
		"API_KEY": "secret123",
	}

	result := compareSecrets("env1", "env2", secrets1, secrets2, false)

	if len(result.OnlyInEnv1) != 2 {
		t.Errorf("OnlyInEnv1 should have 2 items, got %v", result.OnlyInEnv1)
	}
	if len(result.OnlyInEnv2) != 0 {
		t.Errorf("OnlyInEnv2 should be empty, got %v", result.OnlyInEnv2)
	}
	if result.Stats.OnlyInEnv1 != 2 {
		t.Errorf("Stats.OnlyInEnv1 = %d, want 2", result.Stats.OnlyInEnv1)
	}
}

func TestCompareSecrets_OnlyInEnv2(t *testing.T) {
	secrets1 := map[string]string{
		"API_KEY": "secret123",
	}
	secrets2 := map[string]string{
		"API_KEY":   "secret123",
		"NEW_KEY":   "new",
		"OTHER_KEY": "other",
	}

	result := compareSecrets("env1", "env2", secrets1, secrets2, false)

	if len(result.OnlyInEnv1) != 0 {
		t.Errorf("OnlyInEnv1 should be empty, got %v", result.OnlyInEnv1)
	}
	if len(result.OnlyInEnv2) != 2 {
		t.Errorf("OnlyInEnv2 should have 2 items, got %v", result.OnlyInEnv2)
	}
	if result.Stats.OnlyInEnv2 != 2 {
		t.Errorf("Stats.OnlyInEnv2 = %d, want 2", result.Stats.OnlyInEnv2)
	}
}

func TestCompareSecrets_DifferentValues(t *testing.T) {
	secrets1 := map[string]string{
		"API_KEY":     "secret123",
		"DB_PASSWORD": "oldpassword123",
	}
	secrets2 := map[string]string{
		"API_KEY":     "secret123",
		"DB_PASSWORD": "newpassword456",
	}

	result := compareSecrets("env1", "env2", secrets1, secrets2, false)

	if len(result.Different) != 1 {
		t.Errorf("Different should have 1 item, got %v", result.Different)
	}
	if result.Different[0].Key != "DB_PASSWORD" {
		t.Errorf("Different key = %q, want DB_PASSWORD", result.Different[0].Key)
	}
	// Without showValues, Value1 and Value2 should be empty
	if result.Different[0].Value1 != "" || result.Different[0].Value2 != "" {
		t.Errorf("Values should be empty without showValues flag")
	}
	// But previews should be set
	if result.Different[0].Preview1 == "" || result.Different[0].Preview2 == "" {
		t.Errorf("Previews should be set")
	}
	if result.Different[0].Preview1 == result.Different[0].Preview2 {
		t.Errorf("Previews should be different for different values")
	}
}

func TestCompareSecrets_WithShowValues(t *testing.T) {
	secrets1 := map[string]string{
		"API_KEY": "old_value",
	}
	secrets2 := map[string]string{
		"API_KEY": "new_value",
	}

	result := compareSecrets("env1", "env2", secrets1, secrets2, true)

	if len(result.Different) != 1 {
		t.Errorf("Different should have 1 item, got %v", result.Different)
	}
	if result.Different[0].Value1 != "old_value" {
		t.Errorf("Value1 = %q, want old_value", result.Different[0].Value1)
	}
	if result.Different[0].Value2 != "new_value" {
		t.Errorf("Value2 = %q, want new_value", result.Different[0].Value2)
	}
}

func TestCompareSecrets_ComplexScenario(t *testing.T) {
	secrets1 := map[string]string{
		"SAME_KEY":      "same_value",
		"DIFFERENT_KEY": "value1",
		"ONLY_IN_1":     "exclusive",
	}
	secrets2 := map[string]string{
		"SAME_KEY":      "same_value",
		"DIFFERENT_KEY": "value2",
		"ONLY_IN_2":     "also_exclusive",
	}

	result := compareSecrets("production", "staging", secrets1, secrets2, false)

	if result.Stats.TotalEnv1 != 3 {
		t.Errorf("Stats.TotalEnv1 = %d, want 3", result.Stats.TotalEnv1)
	}
	if result.Stats.TotalEnv2 != 3 {
		t.Errorf("Stats.TotalEnv2 = %d, want 3", result.Stats.TotalEnv2)
	}
	if result.Stats.Same != 1 {
		t.Errorf("Stats.Same = %d, want 1", result.Stats.Same)
	}
	if result.Stats.Different != 1 {
		t.Errorf("Stats.Different = %d, want 1", result.Stats.Different)
	}
	if result.Stats.OnlyInEnv1 != 1 {
		t.Errorf("Stats.OnlyInEnv1 = %d, want 1", result.Stats.OnlyInEnv1)
	}
	if result.Stats.OnlyInEnv2 != 1 {
		t.Errorf("Stats.OnlyInEnv2 = %d, want 1", result.Stats.OnlyInEnv2)
	}
}

func TestCompareSecrets_SortedOutput(t *testing.T) {
	secrets1 := map[string]string{
		"ZEBRA": "z",
		"APPLE": "a",
		"MANGO": "m",
	}
	secrets2 := map[string]string{}

	result := compareSecrets("env1", "env2", secrets1, secrets2, false)

	// Keys should be sorted alphabetically
	expected := []string{"APPLE", "MANGO", "ZEBRA"}
	if len(result.OnlyInEnv1) != 3 {
		t.Fatalf("OnlyInEnv1 should have 3 items, got %v", result.OnlyInEnv1)
	}
	for i, key := range expected {
		if result.OnlyInEnv1[i] != key {
			t.Errorf("OnlyInEnv1[%d] = %q, want %q", i, result.OnlyInEnv1[i], key)
		}
	}
}
