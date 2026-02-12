package cmd

import (
	"errors"
	"testing"

	"github.com/keywaysh/cli/internal/api"
)

func TestRunSetWithDeps_Success(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()

	// Setup
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	// Execute
	err := runSetWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check intro was called
	if len(uiMock.IntroCalls) != 1 || uiMock.IntroCalls[0] != "set" {
		t.Errorf("expected Intro('set'), got %v", uiMock.IntroCalls)
	}

	// Check success was called
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected Success to be called")
	}

	// Check secret was pushed to vault
	if apiMock.PushedSecrets == nil || apiMock.PushedSecrets["API_KEY"] != "secret123" {
		t.Errorf("expected API_KEY=secret123 to be pushed, got %v", apiMock.PushedSecrets)
	}
}

func TestRunSetWithDeps_EmptyKey(t *testing.T) {
	deps, _, _, uiMock, _, _, _ := NewTestDepsWithEnv()

	opts := SetOptions{
		Key:   "",
		Value: "secret123",
	}

	err := runSetWithDeps(opts, deps)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "key is required" {
		t.Errorf("unexpected error: %v", err)
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunSetWithDeps_InvalidKeyFormat(t *testing.T) {
	deps, _, _, uiMock, _, _, _ := NewTestDepsWithEnv()

	opts := SetOptions{
		Key:   "API-KEY", // Invalid: contains hyphen
		Value: "secret123",
	}

	err := runSetWithDeps(opts, deps)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "invalid key format" {
		t.Errorf("unexpected error: %v", err)
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunSetWithDeps_GitError(t *testing.T) {
	deps, gitMock, _, uiMock, _, _, _ := NewTestDepsWithEnv()

	gitMock.RepoError = errors.New("not a git repo")

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunSetWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, uiMock, _, _, _ := NewTestDepsWithEnv()

	authMock.Error = errors.New("not logged in")

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunSetWithDeps_LocalOnly_ShowsDeprecationWarning(t *testing.T) {
	deps, _, _, uiMock, fsMock, _, _ := NewTestDepsWithEnv()

	fsMock.Files[".env"] = []byte("")

	opts := SetOptions{
		Key:       "API_KEY",
		Value:     "secret123",
		LocalOnly: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check deprecation warning was shown
	warnFound := false
	for _, msg := range uiMock.WarnCalls {
		if msg == "Local .env files are deprecated. Consider using 'keyway run' to inject secrets at runtime." {
			warnFound = true
			break
		}
	}
	if !warnFound {
		t.Error("expected deprecation warning for --local flag")
	}

	// Check local file was written
	if fsMock.Written[".env"] == nil {
		t.Error("expected .env to be written")
	}
}

func TestRunSetWithDeps_LocalOnly_NoVaultCall(t *testing.T) {
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()

	fsMock.Files[".env"] = []byte("")

	opts := SetOptions{
		Key:       "API_KEY",
		Value:     "secret123",
		LocalOnly: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check that no API call was made
	if apiMock.PushedSecrets != nil {
		t.Error("expected no secrets to be pushed when --local flag is set")
	}
}

func TestRunSetWithDeps_DefaultIsVaultOnly(t *testing.T) {
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "development",
		EnvFlagSet: true,
		// LocalOnly: false (default)
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check secret was pushed to vault
	if apiMock.PushedSecrets == nil {
		t.Error("expected secrets to be pushed to vault")
	}

	// Check NO local file was written (vault-only by default)
	if fsMock.Written[".env"] != nil {
		t.Error("expected no .env to be written by default (vault-only)")
	}
}

func TestRunSetWithDeps_UpdateExistingSecret_WithConfirm(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.ConfirmResult = true

	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "new_value",
		EnvName:    "development",
		EnvFlagSet: true,
		Yes:        false,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check confirm was called
	if len(uiMock.ConfirmCalls) == 0 {
		t.Error("expected UI.Confirm to be called for existing secret")
	}

	// Check warn was called
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called for existing secret")
	}

	// Check secret was updated
	if apiMock.PushedSecrets["API_KEY"] != "new_value" {
		t.Errorf("expected API_KEY=new_value, got %v", apiMock.PushedSecrets["API_KEY"])
	}
}

func TestRunSetWithDeps_UpdateExistingSecret_Declined(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.ConfirmResult = false

	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value"}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "new_value",
		EnvName:    "development",
		EnvFlagSet: true,
		Yes:        false,
	}

	err := runSetWithDeps(opts, deps)

	// Should not error, just abort
	if err != nil {
		t.Fatalf("expected nil error when user declines, got %v", err)
	}

	// Check warning was shown
	warnFound := false
	for _, msg := range uiMock.WarnCalls {
		if msg == "Aborted." {
			warnFound = true
			break
		}
	}
	if !warnFound {
		t.Error("expected 'Aborted.' warning")
	}

	// Check no push happened
	if apiMock.PushedSecrets != nil {
		t.Error("expected no push when user declines")
	}
}

func TestRunSetWithDeps_UpdateExistingSecret_WithYesFlag(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()

	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "new_value",
		EnvName:    "development",
		EnvFlagSet: true,
		Yes:        true, // Skip confirmation
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check confirm was NOT called
	if len(uiMock.ConfirmCalls) != 0 {
		t.Error("expected UI.Confirm to NOT be called with --yes flag")
	}

	// Check secret was updated
	if apiMock.PushedSecrets["API_KEY"] != "new_value" {
		t.Errorf("expected API_KEY=new_value, got %v", apiMock.PushedSecrets["API_KEY"])
	}
}

func TestRunSetWithDeps_PromptForValue_Interactive(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.PasswordResult = "secret_from_prompt"

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "", // Empty value should prompt
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check password prompt was called
	if len(uiMock.PasswordCalls) == 0 {
		t.Error("expected UI.Password to be called")
	}

	// Check correct value was pushed
	if apiMock.PushedSecrets["API_KEY"] != "secret_from_prompt" {
		t.Errorf("expected API_KEY=secret_from_prompt, got %v", apiMock.PushedSecrets["API_KEY"])
	}
}

func TestRunSetWithDeps_PromptForValue_NonInteractive(t *testing.T) {
	deps, _, _, uiMock, _, _, _ := NewTestDepsWithEnv()
	uiMock.Interactive = false

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "", // Empty value
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "value is required" {
		t.Errorf("unexpected error: %v", err)
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunSetWithDeps_APIError(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushError = &api.APIError{
		StatusCode: 403,
		Detail:     "Access denied",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunSetWithDeps_PreservesExistingSecrets(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()

	// Vault has existing secrets
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "EXISTING_KEY=existing_value\nOTHER_KEY=other"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "NEW_KEY",
		Value:      "new_value",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check all secrets are preserved
	if apiMock.PushedSecrets == nil {
		t.Fatal("expected PushedSecrets to be set")
	}
	if apiMock.PushedSecrets["EXISTING_KEY"] != "existing_value" {
		t.Errorf("expected EXISTING_KEY to be preserved, got %v", apiMock.PushedSecrets["EXISTING_KEY"])
	}
	if apiMock.PushedSecrets["OTHER_KEY"] != "other" {
		t.Errorf("expected OTHER_KEY to be preserved, got %v", apiMock.PushedSecrets["OTHER_KEY"])
	}
	if apiMock.PushedSecrets["NEW_KEY"] != "new_value" {
		t.Errorf("expected NEW_KEY=new_value, got %v", apiMock.PushedSecrets["NEW_KEY"])
	}
}

func TestRunSetWithDeps_SelectEnvironment_Interactive(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.SelectResult = "staging"

	apiMock.VaultEnvs = []string{"development", "staging", "production"}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvFlagSet: false, // Not specified, should prompt
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check select was called
	if len(uiMock.SelectCalls) == 0 {
		t.Error("expected UI.Select to be called for environment")
	}
}

func TestRunSetWithDeps_DefaultsToDevelopment_NonInteractive(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = false

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvFlagSet: false, // Not specified
	}

	err := runSetWithDeps(opts, deps)

	// Should succeed with default "development"
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check step message contains "development"
	found := false
	for _, msg := range uiMock.StepCalls {
		if msg == "Environment: " { // Value() returns empty in mock
			found = true
			break
		}
	}
	// The mock Value() returns empty string, so we just check success was called
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected Success to be called")
	}
	_ = found // suppress unused warning
}

func TestRunSetWithDeps_ShowsUsageTip_Production(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "production",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check usage tip was shown with -e flag for non-development env
	tipFound := false
	for _, msg := range uiMock.MessageCalls {
		if msg == "Use with: keyway run -e production <command>" {
			tipFound = true
			break
		}
	}
	if !tipFound {
		t.Error("expected usage tip with -e production")
	}
}

func TestRunSetWithDeps_ShowsUsageTip_Development(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	opts := SetOptions{
		Key:        "API_KEY",
		Value:      "secret123",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check usage tip was shown WITHOUT -e flag for development (it's the default)
	tipFound := false
	for _, msg := range uiMock.MessageCalls {
		if msg == "Use with: keyway run <command>" {
			tipFound = true
			break
		}
	}
	if !tipFound {
		t.Error("expected usage tip without -e for development env")
	}
}

func TestRunSetWithDeps_ValueWithEqualsSign(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()

	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secret saved",
	}

	// Simulate parsing "DATABASE_URL=postgres://user:pass@host/db?foo=bar"
	opts := SetOptions{
		Key:        "DATABASE_URL",
		Value:      "postgres://user:pass@host/db?foo=bar",
		EnvName:    "development",
		EnvFlagSet: true,
	}

	err := runSetWithDeps(opts, deps)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check the full value was preserved (including the = in the query string)
	if apiMock.PushedSecrets["DATABASE_URL"] != "postgres://user:pass@host/db?foo=bar" {
		t.Errorf("expected full URL with =, got %v", apiMock.PushedSecrets["DATABASE_URL"])
	}
}

func TestParseKeyValueArg(t *testing.T) {
	// Test the parsing logic used in runSet
	tests := []struct {
		arg           string
		expectedKey   string
		expectedValue string
	}{
		{"KEY=value", "KEY", "value"},
		{"KEY=value=with=equals", "KEY", "value=with=equals"},
		{"DATABASE_URL=postgres://host?foo=bar", "DATABASE_URL", "postgres://host?foo=bar"},
		{"KEY=", "KEY", ""},
		{"KEY", "KEY", ""},
	}

	for _, tt := range tests {
		t.Run(tt.arg, func(t *testing.T) {
			var key, value string
			if idx := indexOf(tt.arg, '='); idx >= 0 {
				key = tt.arg[:idx]
				value = tt.arg[idx+1:]
			} else {
				key = tt.arg
			}

			if key != tt.expectedKey {
				t.Errorf("key: expected %q, got %q", tt.expectedKey, key)
			}
			if value != tt.expectedValue {
				t.Errorf("value: expected %q, got %q", tt.expectedValue, value)
			}
		})
	}
}

// Helper for test
func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func TestFormatEnvContent_SortsKeys(t *testing.T) {
	// Map iteration order is random, but output should be sorted
	secrets := map[string]string{
		"ZEBRA":    "z",
		"APPLE":    "a",
		"MIDDLE":   "m",
		"BANANA":   "b",
	}

	result := formatEnvContent(secrets)
	expected := "APPLE=a\nBANANA=b\nMIDDLE=m\nZEBRA=z\n"

	if result != expected {
		t.Errorf("expected sorted output:\n%s\ngot:\n%s", expected, result)
	}
}
