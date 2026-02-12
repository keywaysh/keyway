package cmd

import (
	"errors"
	"testing"

	"github.com/keywaysh/cli/internal/api"
)

func TestRunRunWithDeps_Success(t *testing.T) {
	deps, _, _, uiMock, cmdRunner, apiMock := NewTestDepsWithRunner()

	// Setup
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret123\nDB_URL=postgres://localhost",
	}

	opts := RunOptions{
		EnvName:    "development",
		EnvFlagSet: true,
		Command:    "npm",
		Args:       []string{"run", "dev"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Check command was run with correct arguments
	if cmdRunner.LastCommand != "npm" {
		t.Errorf("expected command 'npm', got %q", cmdRunner.LastCommand)
	}

	if len(cmdRunner.LastArgs) != 2 || cmdRunner.LastArgs[0] != "run" || cmdRunner.LastArgs[1] != "dev" {
		t.Errorf("expected args ['run', 'dev'], got %v", cmdRunner.LastArgs)
	}

	// Check secrets were passed
	if cmdRunner.LastSecrets["API_KEY"] != "secret123" {
		t.Errorf("expected API_KEY=secret123, got %q", cmdRunner.LastSecrets["API_KEY"])
	}

	// Check success was called
	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected Success to be called")
	}
}

func TestRunRunWithDeps_GitError(t *testing.T) {
	deps, gitMock, _, uiMock, _, _ := NewTestDepsWithRunner()

	// Setup
	gitMock.RepoError = errors.New("not a git repo")

	opts := RunOptions{
		EnvName:    "development",
		EnvFlagSet: true,
		Command:    "npm",
		Args:       []string{"run", "dev"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunRunWithDeps_AuthError(t *testing.T) {
	deps, _, authMock, uiMock, _, _ := NewTestDepsWithRunner()

	// Setup
	authMock.Error = errors.New("not logged in")

	opts := RunOptions{
		EnvName:    "development",
		EnvFlagSet: true,
		Command:    "npm",
		Args:       []string{"run", "dev"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunRunWithDeps_APIError(t *testing.T) {
	deps, _, _, uiMock, _, apiMock := NewTestDepsWithRunner()

	// Setup
	apiMock.PullError = &api.APIError{
		StatusCode: 404,
		Detail:     "Vault not found",
	}

	opts := RunOptions{
		EnvName:    "development",
		EnvFlagSet: true,
		Command:    "npm",
		Args:       []string{"run", "dev"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if len(uiMock.ErrorCalls) == 0 {
		t.Error("expected UI.Error to be called")
	}
}

func TestRunRunWithDeps_CommandError(t *testing.T) {
	deps, _, _, _, cmdRunner, apiMock := NewTestDepsWithRunner()

	// Setup
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret123",
	}
	cmdRunner.RunError = errors.New("command failed")

	opts := RunOptions{
		EnvName:    "development",
		EnvFlagSet: true,
		Command:    "npm",
		Args:       []string{"run", "dev"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if err.Error() != "command failed" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunRunWithDeps_EmptySecrets(t *testing.T) {
	deps, _, _, uiMock, cmdRunner, apiMock := NewTestDepsWithRunner()

	// Setup - vault returns empty content
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "",
	}

	opts := RunOptions{
		EnvName:    "development",
		EnvFlagSet: true,
		Command:    "echo",
		Args:       []string{"hello"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Command should still be run with empty secrets
	if cmdRunner.LastCommand != "echo" {
		t.Errorf("expected command 'echo', got %q", cmdRunner.LastCommand)
	}

	if len(cmdRunner.LastSecrets) != 0 {
		t.Errorf("expected empty secrets, got %v", cmdRunner.LastSecrets)
	}

	if len(uiMock.SuccessCalls) == 0 {
		t.Error("expected Success to be called")
	}
}

func TestRunRunWithDeps_MultipleArgs(t *testing.T) {
	deps, _, _, _, cmdRunner, apiMock := NewTestDepsWithRunner()

	// Setup
	apiMock.PullResponse = &api.PullSecretsResponse{
		Content: "API_KEY=secret",
	}

	opts := RunOptions{
		EnvName:    "production",
		EnvFlagSet: true,
		Command:    "python3",
		Args:       []string{"-m", "pytest", "-v", "--coverage"},
	}

	// Execute
	err := runRunWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if cmdRunner.LastCommand != "python3" {
		t.Errorf("expected command 'python3', got %q", cmdRunner.LastCommand)
	}

	expectedArgs := []string{"-m", "pytest", "-v", "--coverage"}
	if len(cmdRunner.LastArgs) != len(expectedArgs) {
		t.Errorf("expected %d args, got %d", len(expectedArgs), len(cmdRunner.LastArgs))
	}

	for i, arg := range expectedArgs {
		if cmdRunner.LastArgs[i] != arg {
			t.Errorf("expected arg[%d]=%q, got %q", i, arg, cmdRunner.LastArgs[i])
		}
	}
}
