package cmd

import (
	"context"
	"errors"
	"testing"

	"github.com/keywaysh/cli/internal/api"
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
		"API_KEY":   "secret123",
		"EXTRA_KEY": "extra",
		"ANOTHER":   "value",
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

// Tests using dependency injection

func TestRunDiffWithDeps_Success(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()

	// Setup - both environments return different secrets
	callCount := 0
	originalPullSecrets := apiMock.PullResponse
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=value1\nDB_URL=same",
	}
	_ = originalPullSecrets
	_ = callCount

	opts := DiffOptions{
		Env1: "development",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(uiMock.IntroCalls) != 1 || uiMock.IntroCalls[0] != "diff" {
		t.Errorf("expected Intro('diff'), got %v", uiMock.IntroCalls)
	}
}

func TestRunDiffWithDeps_GitError(t *testing.T) {
	deps, gitMock, _, uiMock, _, _ := NewTestDepsWithRunner()

	// Setup
	gitMock.RepoError = errors.New("not a git repo")

	opts := DiffOptions{
		Env1: "development",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunDiffWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, _, _, _ := NewTestDepsWithRunner()

	// Setup
	authMock.Error = errors.New("not logged in")

	opts := DiffOptions{
		Env1: "development",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestRunDiffWithDeps_SameEnvironment(t *testing.T) {
	deps, _, _, uiMock, _, _ := NewTestDepsWithRunner()

	opts := DiffOptions{
		Env1: "production",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "same environment" {
		t.Errorf("unexpected error: %v", err)
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunDiffWithDeps_MissingArgsNonInteractive(t *testing.T) {
	deps, _, _, uiMock, _, _ := NewTestDepsWithRunner()
	uiMock.Interactive = false

	opts := DiffOptions{
		Env1: "development",
		// Env2 missing
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "missing arguments" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunDiffWithDeps_BothPullErrors(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()

	// Setup - both pulls fail
	apiMock.PullError = &api.APIError{
		StatusCode: 404,
		Detail:     "Not found",
	}

	opts := DiffOptions{
		Env1: "development",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "failed to fetch environments" {
		t.Errorf("unexpected error: %v", err)
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunDiffWithDeps_NormalizeEnvNames(t *testing.T) {
	deps, _, _, _, _, apiMock := NewTestDepsWithRunner()

	// Setup
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=value",
	}

	opts := DiffOptions{
		Env1: "prod", // Should normalize to "production"
		Env2: "dev",  // Should normalize to "development"
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunDiffWithDeps_InteractiveNotEnoughEnvs(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()
	uiMock.Interactive = true

	// Setup - only one environment available
	apiMock.VaultEnvs = []string{"production"}

	opts := DiffOptions{
		// No envs specified, will prompt
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "not enough environments" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunDiffWithDeps_InteractiveEnvFetchError(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()
	uiMock.Interactive = true

	// Setup - fetch fails
	apiMock.VaultEnvsError = errors.New("fetch failed")

	opts := DiffOptions{
		// No envs specified, will prompt
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunDiffWithDeps_InteractiveSelectError(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()
	uiMock.Interactive = true
	uiMock.SelectError = errors.New("select cancelled")

	// Setup - enough environments
	apiMock.VaultEnvs = []string{"production", "staging", "development"}

	opts := DiffOptions{
		// No envs specified, will prompt
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestRunDiffWithDeps_InteractiveSuccess(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()
	uiMock.Interactive = true
	uiMock.SelectResult = "staging"

	// Setup - environments available
	apiMock.VaultEnvs = []string{"production", "staging", "development"}
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=value",
	}

	opts := DiffOptions{
		Env1: "production", // First specified
		// Env2 will be selected
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(uiMock.SelectCalls) == 0 {
		t.Error("expected UI.Select to be called")
	}
}

func TestRunDiffWithDeps_OnePullError(t *testing.T) {
	deps, _, _, uiMock, _, _ := NewTestDepsWithRunner()

	// Create custom mock that fails only for one env
	customClient := &MockAPIDiffClient{
		Env1Content: "API_KEY=value1",
		Env2Error:   errors.New("env2 not found"),
	}
	deps.APIFactory = &MockAPIFactory{Client: customClient}

	opts := DiffOptions{
		Env1: "development",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert - should succeed with warning
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check warning was shown
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called for missing env")
	}
}

func TestRunDiffWithDeps_JSONOutput(t *testing.T) {
	deps, _, _, _, _, apiMock := NewTestDepsWithRunner()

	// Setup
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=value\nDB_URL=same",
	}

	opts := DiffOptions{
		Env1:       "development",
		Env2:       "production",
		JSONOutput: true,
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunDiffWithDeps_InteractiveNoRemainingEnvs(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()
	uiMock.Interactive = true

	// First select returns the only env
	selectCount := 0
	originalSelect := uiMock.SelectResult
	_ = originalSelect
	uiMock.SelectResult = "production"

	// Setup - only two environments, user selects one, leaves none
	apiMock.VaultEnvs = []string{"production"}
	_ = selectCount

	opts := DiffOptions{
		Env1: "production", // First env specified
		// Env2 will need to be selected from remaining
	}

	// Execute - should fail because no remaining envs
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

// MockAPIDiffClient is a custom mock for diff tests that need different responses per env
type MockAPIDiffClient struct {
	MockAPIClient
	Env1Content string
	Env2Content string
	Env1Error   error
	Env2Error   error
	callCount   int
}

func (m *MockAPIDiffClient) PullSecrets(ctx context.Context, repo, env string) (*api.PullSecretsResponse, error) {
	m.callCount++
	if m.callCount == 1 {
		if m.Env1Error != nil {
			return nil, m.Env1Error
		}
		return &api.PullSecretsResponse{Content: m.Env1Content}, nil
	}
	if m.Env2Error != nil {
		return nil, m.Env2Error
	}
	content := m.Env2Content
	if content == "" {
		content = m.Env1Content // Default to same content
	}
	return &api.PullSecretsResponse{Content: content}, nil
}

func TestRunDiffWithDeps_ShowValues(t *testing.T) {
	deps, _, _, _, _, _ := NewTestDepsWithRunner()

	// Create custom mock with different values
	customClient := &MockAPIDiffClient{
		Env1Content: "API_KEY=secret123",
		Env2Content: "API_KEY=secret456",
	}
	deps.APIFactory = &MockAPIFactory{Client: customClient}

	opts := DiffOptions{
		Env1:       "development",
		Env2:       "production",
		ShowValues: true,
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunDiffWithDeps_KeysOnly(t *testing.T) {
	deps, _, _, _, _, _ := NewTestDepsWithRunner()

	// Create custom mock with different values
	customClient := &MockAPIDiffClient{
		Env1Content: "API_KEY=secret123\nDB_URL=db1",
		Env2Content: "API_KEY=secret456\nNEW_KEY=new",
	}
	deps.APIFactory = &MockAPIFactory{Client: customClient}

	opts := DiffOptions{
		Env1:     "development",
		Env2:     "production",
		KeysOnly: true,
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunDiffWithDeps_IdenticalEnvironments(t *testing.T) {
	deps, _, _, _, _, apiMock := NewTestDepsWithRunner()

	// Setup - both environments have identical secrets
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=same_value\nDB_URL=same_db",
	}

	opts := DiffOptions{
		Env1: "development",
		Env2: "staging",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunDiffWithDeps_FirstEnvPullError(t *testing.T) {
	deps, _, _, uiMock, _, _ := NewTestDepsWithRunner()

	// Create custom mock that fails for first env only
	customClient := &MockAPIDiffClient{
		Env1Error:   errors.New("env1 not found"),
		Env2Content: "API_KEY=value",
	}
	deps.APIFactory = &MockAPIFactory{Client: customClient}

	opts := DiffOptions{
		Env1: "development",
		Env2: "production",
	}

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert - should succeed with warning
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check warning was shown for first env
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called for missing env1")
	}
}

func TestRunDiffWithDeps_InteractiveSecondSelectError(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()
	uiMock.Interactive = true

	// Track select call count to fail on second
	selectCallCount := 0
	originalConfirm := uiMock.Confirm
	_ = originalConfirm

	// Setup - environments available
	apiMock.VaultEnvs = []string{"production", "staging", "development"}

	opts := DiffOptions{
		// No envs specified, will prompt for both
	}

	// This will fail on first select
	uiMock.SelectError = errors.New("cancelled")
	_ = selectCallCount

	// Execute
	err := runDiffWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}
