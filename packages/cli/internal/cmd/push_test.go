package cmd

import (
	"errors"
	"testing"

	"github.com/keywaysh/cli/internal/api"
)

func TestRunPushWithDeps_Success(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123\nDB_URL=postgres://localhost")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check intro was called
	if len(uiMock.IntroCalls) != 1 || uiMock.IntroCalls[0] != "push" {
		t.Errorf("expected Intro('push'), got %v", uiMock.IntroCalls)
	}

	// Check success was called
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected Success to be called")
	}
}

func TestRunPushWithDeps_NoEnvFile(t *testing.T) {
	deps, _, _, uiMock, _, envMock, _ := NewTestDepsWithEnv()

	// Setup - no env files discovered, non-interactive
	envMock.Candidates = []EnvCandidate{}
	uiMock.Interactive = false

	opts := PushOptions{
		EnvName:    "development",
		File:       "", // No file specified
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "no .env file found" {
		t.Errorf("unexpected error: %v", err)
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_GitError(t *testing.T) {
	deps, gitMock, _, uiMock, fsMock, envMock, _ := NewTestDepsWithEnv()

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	gitMock.RepoError = errors.New("not a git repo")

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, uiMock, fsMock, envMock, _ := NewTestDepsWithEnv()

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	authMock.Error = errors.New("not logged in")

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_FileNotFound(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, _ := NewTestDepsWithEnv()

	// Setup - file doesn't exist
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	fsMock.ReadError = errors.New("file not found")

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_EmptyFile(t *testing.T) {
	deps, _, _, _, fsMock, envMock, _ := NewTestDepsWithEnv()

	// Setup - empty file
	fsMock.Files[".env"] = []byte("")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "file is empty" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunPushWithDeps_NoVariables(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, _ := NewTestDepsWithEnv()

	// Setup - file with only comments
	fsMock.Files[".env"] = []byte("# This is just a comment\n# No variables here")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "no variables found" {
		t.Errorf("unexpected error: %v", err)
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_APIError(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushError = &api.APIError{
		StatusCode: 403,
		Detail:     "Access denied",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_RequiresConfirmation(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	_ = uiMock // silence unused variable

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        false, // No auto-confirm
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert - should error because not interactive and no --yes
	if err == nil {
		t.Fatal("expected error when no --yes in non-interactive mode")
	}

	if err.Error() != "confirmation required - use --yes in non-interactive mode" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunPushWithDeps_UsesCandidateFile(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - no file specified, use discovered candidate
	fsMock.Files[".env.staging"] = []byte("API_KEY=staging_secret")
	envMock.Candidates = []EnvCandidate{{File: ".env.staging", Env: "staging"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "", // Not specified, should use candidate
		File:       "", // Not specified, should use candidate
		Yes:        true,
		EnvFlagSet: false,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check success was called
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected Success to be called")
	}
}

func TestRunPushWithDeps_GitignoreWarning(t *testing.T) {
	deps, gitMock, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - .env not in gitignore
	gitMock.EnvInGitignore = false
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check warning was displayed
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called for missing gitignore")
	}
}

func TestRunPushWithDeps_APIErrorWithUpgradeURL(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - API returns error with upgrade URL
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushError = &api.APIError{
		StatusCode: 403,
		Detail:     "Plan limit exceeded",
		UpgradeURL: "https://keyway.sh/upgrade",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error and upgrade message were displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
	if len(uiMock.MessageCalls) == 0 {
		t.Error("expected UI.Message to be called for upgrade URL")
	}
}

func TestRunPushWithDeps_ShowsStats(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=new_value\nDB_URL=updated\nNEW_VAR=new")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value\nDB_URL=old"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
		Stats: &struct {
			Created int `json:"created"`
			Updated int `json:"updated"`
			Deleted int `json:"deleted"`
		}{Created: 1, Updated: 2, Deleted: 0},
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check stats were displayed
	statsFound := false
	for _, msg := range uiMock.MessageCalls {
		if len(msg) > 0 {
			statsFound = true
			break
		}
	}
	if !statsFound && len(uiMock.MessageCalls) == 0 {
		t.Error("expected stats to be displayed")
	}
}

func TestRunPushWithDeps_InteractiveSelectEnv(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.SelectResult = "staging"

	// Setup - multiple env files discovered
	fsMock.Files[".env"] = []byte("API_KEY=dev_secret")
	fsMock.Files[".env.staging"] = []byte("API_KEY=staging_secret")
	envMock.Candidates = []EnvCandidate{
		{File: ".env", Env: "development"},
		{File: ".env.staging", Env: "staging"},
	}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "",
		File:       "",
		Yes:        true,
		EnvFlagSet: false,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunPushWithDeps_InteractiveConfirm(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.ConfirmResult = true

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        false, // Requires interactive confirmation
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check confirm was called
	if len(uiMock.ConfirmCalls) == 0 {
		t.Error("expected UI.Confirm to be called")
	}
}

func TestRunPushWithDeps_InteractiveDecline(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	uiMock.Interactive = true
	uiMock.ConfirmResult = false // User declines

	// Setup
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: ""}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        false,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert - push returns nil when user declines (logs warning instead)
	if err != nil {
		t.Fatalf("expected nil error when user declines, got %v", err)
	}

	// Check warning was shown
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called for abort")
	}
}

func TestRunPushWithDeps_PullError(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - pull fails
	fsMock.Files[".env"] = []byte("API_KEY=secret123")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullError = errors.New("pull failed")

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPushWithDeps_WithDiff(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - existing secrets differ from new ones
	fsMock.Files[".env"] = []byte("API_KEY=new_value\nNEW_KEY=added")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value\nDELETED_KEY=removed"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check diff was displayed
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected UI.Success to be called")
	}
}

func TestRunPushWithDeps_WithoutPrune_PreservesVaultSecrets(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - local has 2 secrets, vault has an additional secret
	fsMock.Files[".env"] = []byte("API_KEY=local_value\nNEW_KEY=new")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value\nVAULT_ONLY=should_be_preserved"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
		Prune:      false, // Default: don't prune
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check that VAULT_ONLY was preserved in the push (merged)
	if apiMock.PushedSecrets == nil {
		t.Fatal("expected PushedSecrets to be set")
	}
	if _, ok := apiMock.PushedSecrets["VAULT_ONLY"]; !ok {
		t.Error("expected VAULT_ONLY to be preserved when --prune is not set")
	}
	if apiMock.PushedSecrets["VAULT_ONLY"] != "should_be_preserved" {
		t.Errorf("expected VAULT_ONLY='should_be_preserved', got '%s'", apiMock.PushedSecrets["VAULT_ONLY"])
	}

	// Check that local secrets are also present
	if apiMock.PushedSecrets["API_KEY"] != "local_value" {
		t.Errorf("expected API_KEY='local_value', got '%s'", apiMock.PushedSecrets["API_KEY"])
	}
	if apiMock.PushedSecrets["NEW_KEY"] != "new" {
		t.Errorf("expected NEW_KEY='new', got '%s'", apiMock.PushedSecrets["NEW_KEY"])
	}

	// Check that warning was shown about vault-only secrets
	warnFound := false
	for _, msg := range uiMock.WarnCalls {
		if len(msg) > 0 {
			warnFound = true
			break
		}
	}
	if !warnFound {
		t.Error("expected warning about vault-only secrets")
	}
}

func TestRunPushWithDeps_WithPrune_RemovesVaultSecrets(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - local has 2 secrets, vault has an additional secret
	fsMock.Files[".env"] = []byte("API_KEY=local_value\nNEW_KEY=new")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value\nVAULT_ONLY=will_be_removed"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
		Prune:      true, // Prune enabled
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check that VAULT_ONLY was NOT included in the push (will be deleted by backend)
	if apiMock.PushedSecrets == nil {
		t.Fatal("expected PushedSecrets to be set")
	}
	if _, ok := apiMock.PushedSecrets["VAULT_ONLY"]; ok {
		t.Error("expected VAULT_ONLY to NOT be in push when --prune is set")
	}

	// Check that local secrets are present
	if len(apiMock.PushedSecrets) != 2 {
		t.Errorf("expected 2 secrets, got %d", len(apiMock.PushedSecrets))
	}

	// Check that "Will be moved to trash" message was shown
	diffRemovedFound := false
	for _, key := range uiMock.DiffRemovedCalls {
		if key == "VAULT_ONLY" {
			diffRemovedFound = true
			break
		}
	}
	if !diffRemovedFound {
		t.Error("expected DiffRemoved to be called for VAULT_ONLY")
	}

	// Check no warning about vault-only secrets (since we're pruning)
	// The warn should be about gitignore, not about vault-only secrets
	for _, msg := range uiMock.WarnCalls {
		if msg != ".env files are not in .gitignore - secrets may be committed" {
			// Skip gitignore warning
			t.Errorf("unexpected warning: %s", msg)
		}
	}
}

func TestRunPushWithDeps_NoVaultOnlySecrets_NoPruneWarning(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()

	// Setup - local and vault have same keys (no vault-only secrets)
	fsMock.Files[".env"] = []byte("API_KEY=new_value\nDB_URL=updated")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "API_KEY=old_value\nDB_URL=old"}
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets saved",
	}

	opts := PushOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
		Prune:      false,
	}

	// Execute
	err := runPushWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check that no warning about --prune was shown (only gitignore warning expected)
	pruneWarnFound := false
	for _, msg := range uiMock.WarnCalls {
		if msg != ".env files are not in .gitignore - secrets may be committed" {
			pruneWarnFound = true
			break
		}
	}
	if pruneWarnFound {
		t.Error("did not expect prune warning when there are no vault-only secrets")
	}
}
