package cmd

import (
	"errors"
	"testing"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
)

func TestFormatCandidates_Empty(t *testing.T) {
	result := formatCandidates(nil)

	if result != "" {
		t.Errorf("formatCandidates(nil) = %q, want empty string", result)
	}
}

func TestFormatCandidates_Single(t *testing.T) {
	candidates := []env.Candidate{
		{File: ".env", Env: "development"},
	}

	result := formatCandidates(candidates)

	if result != ".env" {
		t.Errorf("formatCandidates() = %q, want \".env\"", result)
	}
}

func TestFormatCandidates_Multiple(t *testing.T) {
	candidates := []env.Candidate{
		{File: ".env", Env: "development"},
		{File: ".env.production", Env: "production"},
		{File: ".env.staging", Env: "staging"},
	}

	result := formatCandidates(candidates)

	expected := ".env, .env.production, .env.staging"
	if result != expected {
		t.Errorf("formatCandidates() = %q, want %q", result, expected)
	}
}

func TestFormatCandidates_OnlyProduction(t *testing.T) {
	candidates := []env.Candidate{
		{File: ".env.production", Env: "production"},
	}

	result := formatCandidates(candidates)

	if result != ".env.production" {
		t.Errorf("formatCandidates() = %q, want \".env.production\"", result)
	}
}

func TestFormatCandidates_VariousEnvFiles(t *testing.T) {
	candidates := []env.Candidate{
		{File: ".env", Env: "development"},
		{File: ".env.test", Env: "test"},
		{File: ".env.development.local", Env: "development.local"},
	}

	result := formatCandidates(candidates)

	expected := ".env, .env.test, .env.development.local"
	if result != expected {
		t.Errorf("formatCandidates() = %q, want %q", result, expected)
	}
}

func TestBuildDeepLinkInstallURL_NilRepoIds(t *testing.T) {
	baseURL := "https://github.com/apps/keyway/installations/new"
	result := buildDeepLinkInstallURL(baseURL, nil)

	if result != baseURL {
		t.Errorf("buildDeepLinkInstallURL with nil repoIds should return baseURL, got %q", result)
	}
}

func TestBuildDeepLinkInstallURL_WithRepoIds(t *testing.T) {
	baseURL := "https://github.com/apps/keyway/installations/new"
	repoIds := &api.RepoIds{OwnerID: 123, RepoID: 456}

	result := buildDeepLinkInstallURL(baseURL, repoIds)

	expected := "https://github.com/apps/keyway/installations/new/permissions?suggested_target_id=123&repository_ids[]=456"
	if result != expected {
		t.Errorf("buildDeepLinkInstallURL() = %q, want %q", result, expected)
	}
}

func TestFormatEnvCandidates(t *testing.T) {
	candidates := []EnvCandidate{
		{File: ".env", Env: "development"},
		{File: ".env.production", Env: "production"},
	}

	result := formatEnvCandidates(candidates)

	expected := ".env, .env.production"
	if result != expected {
		t.Errorf("formatEnvCandidates() = %q, want %q", result, expected)
	}
}

// Tests using dependency injection

func TestRunInitWithDeps_GitError(t *testing.T) {
	deps, gitMock, _, uiMock, _, _ := NewTestDeps()

	// Setup - not a git repo
	gitMock.RepoError = errors.New("not a git repo")

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunInitWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, uiMock, _, _ := NewTestDeps()

	// Setup - auth fails
	authMock.Error = errors.New("not logged in")

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunInitWithDeps_VaultAlreadyExists(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	apiMock.VaultDetails = &api.VaultDetails{ID: "vault-123", RepoFullName: "owner/repo", SecretCount: 5}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Should show success for already initialized
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected UI.Success to be called")
	}
}

func TestRunInitWithDeps_CreateVaultSuccess(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitResponse = &api.InitVaultResponse{VaultID: "vault-123"}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected UI.Success to be called")
	}
}

func TestEnsureLoginAndGitHubAppWithDeps_InvalidRepoFormat(t *testing.T) {
	deps, _, _, _, _, _ := NewTestDeps()

	// Execute with invalid repo format
	_, err := ensureLoginAndGitHubAppWithDeps("invalid-repo", deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "invalid repository format: invalid-repo" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestEnsureLoginAndGitHubAppWithDeps_AppAlreadyInstalled(t *testing.T) {
	deps, _, _, _, _, apiMock := NewTestDeps()

	// Setup - app already installed
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	// Execute
	token, err := ensureLoginAndGitHubAppWithDeps("owner/repo", deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if token == "" {
		t.Error("expected token, got empty")
	}
}

func TestEnsureLoginAndGitHubAppWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, _, _, _ := NewTestDeps()

	// Setup - auth fails
	authMock.Error = errors.New("not logged in")

	// Execute
	_, err := ensureLoginAndGitHubAppWithDeps("owner/repo", deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestEnsureLoginAndGitHubAppWithDeps_AppCheckError(t *testing.T) {
	deps, _, _, _, _, apiMock := NewTestDeps()

	// Setup - check fails but should continue
	apiMock.CheckGitHubAppInstallationError = errors.New("check failed")

	// Execute
	token, err := ensureLoginAndGitHubAppWithDeps("owner/repo", deps)

	// Assert - should succeed despite check failure
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if token == "" {
		t.Error("expected token, got empty")
	}
}

func TestEnsureLoginAndGitHubAppWithDeps_AppNotInstalledNonInteractive(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - app not installed, non-interactive
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{
		Installed:  false,
		InstallURL: "https://github.com/apps/keyway/installations/new",
	}
	uiMock.Interactive = false

	// Execute
	_, err := ensureLoginAndGitHubAppWithDeps("owner/repo", deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "GitHub App installation required" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestEnsureLoginAndGitHubAppWithDeps_UserDeclinesInstall(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{
		Installed:  false,
		InstallURL: "https://github.com/apps/keyway/installations/new",
	}
	uiMock.Interactive = true
	uiMock.ConfirmResult = false // User declines

	// Execute
	_, err := ensureLoginAndGitHubAppWithDeps("owner/repo", deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "GitHub App installation required" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunInitWithDeps_GitignoreNotConfigured(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - gitignore not configured, non-interactive
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = false
	uiMock.Interactive = false
	apiMock.VaultDetails = &api.VaultDetails{ID: "vault-123", RepoFullName: "owner/repo", SecretCount: 5}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check warning was displayed
	if len(uiMock.WarnCalls) == 0 {
		t.Error("expected UI.Warn to be called")
	}
}

func TestRunInitWithDeps_GitignoreAddInteractive(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - gitignore not configured, interactive, user confirms
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = false
	uiMock.Interactive = true
	uiMock.ConfirmResult = true // User says yes to adding gitignore
	apiMock.VaultDetails = &api.VaultDetails{ID: "vault-123", RepoFullName: "owner/repo", SecretCount: 5}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check confirm was called
	if len(uiMock.ConfirmCalls) == 0 {
		t.Error("expected UI.Confirm to be called")
	}
}

func TestRunInitWithDeps_EnvFilesFoundPushDeclined(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	uiMock.Interactive = true
	uiMock.ConfirmResult = false // User declines push
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitResponse = &api.InitVaultResponse{VaultID: "vault-123"}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	// Add env candidates
	envMock := deps.Env.(*MockEnvHelper)
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check success was called
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected UI.Success to be called")
	}
}

func TestRunInitWithDeps_NoEnvFilesCreateDeclined(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	uiMock.Interactive = true
	uiMock.ConfirmResult = false // User declines creating .env
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitResponse = &api.InitVaultResponse{VaultID: "vault-123"}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunInitWithDeps_NoEnvFilesCreateAccepted(t *testing.T) {
	deps, gitMock, _, uiMock, fsMock, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	uiMock.Interactive = true
	uiMock.ConfirmResult = true // User accepts creating .env
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitResponse = &api.InitVaultResponse{VaultID: "vault-123"}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check .env was created
	if _, ok := fsMock.Written[".env"]; !ok {
		t.Error("expected .env file to be created")
	}
}

func TestRunInitWithDeps_VaultCreationError(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitError = errors.New("vault creation failed")
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunInitWithDeps_VaultAlreadyExistsConflict(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - vault creation returns 409 conflict
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitError = &api.APIError{
		StatusCode: 409,
		Detail:     "vault already exists",
	}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert - should succeed (409 means already exists)
	if err != nil {
		t.Fatalf("expected no error for 409 conflict, got %v", err)
	}

	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected UI.Success to be called")
	}
}

func TestRunInitWithDeps_NonInteractiveNoEnvFiles(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	uiMock.Interactive = false
	apiMock.VaultDetailsError = &api.APIError{StatusCode: 404, Detail: "vault not found"}
	apiMock.InitResponse = &api.InitVaultResponse{VaultID: "vault-123"}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check message about running push was shown
	if len(uiMock.MessageCalls) == 0 {
		t.Error("expected UI.Message to be called")
	}
}

func TestRunInitWithDeps_VaultExistsButEmpty(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - vault exists but has no secrets
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	uiMock.Interactive = false
	apiMock.VaultDetails = &api.VaultDetails{
		ID:           "vault-123",
		RepoFullName: "owner/repo",
		SecretCount:  0, // Empty vault
	}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Should show "Vault ready!" for empty vault (goes to push flow)
	foundVaultReady := false
	for _, msg := range uiMock.SuccessCalls {
		if msg == "Vault ready!" {
			foundVaultReady = true
			break
		}
	}
	if !foundVaultReady {
		t.Errorf("expected 'Vault ready!' success message, got: %v", uiMock.SuccessCalls)
	}
}

func TestRunInitWithDeps_VaultExistsWithSecrets(t *testing.T) {
	deps, gitMock, _, uiMock, _, apiMock := NewTestDeps()

	// Setup - vault exists with secrets
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	uiMock.Interactive = false
	apiMock.VaultDetails = &api.VaultDetails{
		ID:           "vault-123",
		RepoFullName: "owner/repo",
		SecretCount:  5, // Has secrets
	}
	apiMock.CheckGitHubAppInstallationResponse = &api.GitHubAppInstallationStatus{Installed: true}

	opts := InitOptions{}

	// Execute
	err := runInitWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Should show "Already initialized!" for vault with secrets
	foundAlreadyInit := false
	for _, msg := range uiMock.SuccessCalls {
		if msg == "Already initialized!" {
			foundAlreadyInit = true
			break
		}
	}
	if !foundAlreadyInit {
		t.Errorf("expected 'Already initialized!' success message, got: %v", uiMock.SuccessCalls)
	}
}
