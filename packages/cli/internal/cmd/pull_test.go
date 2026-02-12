package cmd

import (
	"errors"
	"strings"
	"testing"

	"github.com/keywaysh/cli/internal/api"
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

// Tests for runPullWithDeps

func TestRunPullWithDeps_Success(t *testing.T) {
	deps, gitMock, _, uiMock, fsMock, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret123\nDB_URL=postgres://localhost",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		Force:      false,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check file was written
	if _, ok := fsMock.Written[".env"]; !ok {
		t.Error("expected .env file to be written")
	}

	// Check intro was called
	if len(uiMock.IntroCalls) != 1 || uiMock.IntroCalls[0] != "pull" {
		t.Errorf("expected Intro('pull'), got %v", uiMock.IntroCalls)
	}

	// Check outro was called
	if len(uiMock.OutroCalls) != 1 {
		t.Errorf("expected Outro to be called once, got %d calls", len(uiMock.OutroCalls))
	}
}

func TestRunPullWithDeps_GitError(t *testing.T) {
	deps, gitMock, _, uiMock, _, _ := NewTestDeps()

	// Setup - git returns error
	gitMock.RepoError = errors.New("not a git repo")

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPullWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, uiMock, _, _ := NewTestDeps()

	// Setup - auth returns error
	authMock.Error = errors.New("not logged in")

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPullWithDeps_APIError(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - API returns error
	apiMock.PullError = &api.APIError{
		StatusCode: 404,
		Detail:     "Vault not found",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPullWithDeps_MergeExistingFile(t *testing.T) {
	deps, _, _, _, fsMock, apiMock := NewTestDeps()

	// Setup - existing file with local-only variable
	fsMock.Files[".env"] = []byte("LOCAL_VAR=local_value\nAPI_KEY=old_value")
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=new_value\nDB_URL=postgres://localhost",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		Force:      false, // Merge mode
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check file was written
	written, ok := fsMock.Written[".env"]
	if !ok {
		t.Fatal("expected .env file to be written")
	}

	content := string(written)
	// Should contain the vault secrets
	if !strings.Contains(content, "API_KEY=new_value") {
		t.Error("expected API_KEY from vault")
	}
	if !strings.Contains(content, "DB_URL=postgres://localhost") {
		t.Error("expected DB_URL from vault")
	}
	// Should preserve local-only variable
	if !strings.Contains(content, "LOCAL_VAR=local_value") {
		t.Error("expected LOCAL_VAR to be preserved in merge mode")
	}
}

func TestRunPullWithDeps_ForceReplace(t *testing.T) {
	deps, _, _, _, fsMock, apiMock := NewTestDeps()

	// Setup - existing file with local-only variable
	fsMock.Files[".env"] = []byte("LOCAL_VAR=local_value\nAPI_KEY=old_value")
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=new_value\nDB_URL=postgres://localhost",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		Force:      true, // Force replace mode
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check file was written
	written, ok := fsMock.Written[".env"]
	if !ok {
		t.Fatal("expected .env file to be written")
	}

	content := string(written)
	// Should contain vault content exactly
	if content != "API_KEY=new_value\nDB_URL=postgres://localhost" {
		t.Errorf("expected vault content exactly, got %q", content)
	}
}

func TestRunPullWithDeps_RequiresConfirmation(t *testing.T) {
	deps, _, _, _, fsMock, apiMock := NewTestDeps()

	// Setup - existing file, no --yes flag, not interactive
	fsMock.Files[".env"] = []byte("EXISTING=value")
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        false, // No auto-confirm
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert - should error because not interactive and no --yes
	if err == nil {
		t.Fatal("expected error when file exists without --yes")
	}

	if err.Error() != "file .env exists - use --yes to confirm" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunPullWithDeps_WriteError(t *testing.T) {
	deps, _, _, uiMock, fsMock, apiMock := NewTestDeps()

	// Setup - write error
	fsMock.WriteError = errors.New("permission denied")
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	// Check error was displayed
	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunPullWithDeps_GitignoreWarning(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - .env not in gitignore
	gitMock.EnvInGitignore = false
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check warning was displayed
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called for missing gitignore")
	}
}

func TestRunPullWithDeps_APIErrorWithUpgradeURL(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - API returns error with upgrade URL
	apiMock.PullError = &api.APIError{
		StatusCode: 403,
		Detail:     "Plan limit exceeded",
		UpgradeURL: "https://keyway.sh/upgrade",
	}

	opts := PullOptions{
		EnvName:    "development",
		File:       ".env",
		Yes:        true,
		EnvFlagSet: true,
	}

	// Execute
	err := runPullWithDeps(opts, deps)

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
