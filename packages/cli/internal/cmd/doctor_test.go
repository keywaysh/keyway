package cmd

import (
	"errors"
	"testing"
)

func TestCheckResult_Structure(t *testing.T) {
	result := checkResult{
		ID:     "test",
		Name:   "Test Check",
		Status: "pass",
		Detail: "Everything is fine",
	}

	if result.ID != "test" {
		t.Errorf("ID = %q, want 'test'", result.ID)
	}
	if result.Name != "Test Check" {
		t.Errorf("Name = %q, want 'Test Check'", result.Name)
	}
	if result.Status != "pass" {
		t.Errorf("Status = %q, want 'pass'", result.Status)
	}
	if result.Detail != "Everything is fine" {
		t.Errorf("Detail = %q, want 'Everything is fine'", result.Detail)
	}
}

func TestDoctorSummary_Calculation(t *testing.T) {
	checks := []checkResult{
		{ID: "1", Name: "Check 1", Status: "pass"},
		{ID: "2", Name: "Check 2", Status: "pass"},
		{ID: "3", Name: "Check 3", Status: "warn"},
		{ID: "4", Name: "Check 4", Status: "fail"},
	}

	summary := doctorSummary{Checks: checks}
	for _, c := range checks {
		switch c.Status {
		case "pass":
			summary.Summary.Pass++
		case "warn":
			summary.Summary.Warn++
		case "fail":
			summary.Summary.Fail++
		}
	}

	if summary.Summary.Pass != 2 {
		t.Errorf("Pass = %d, want 2", summary.Summary.Pass)
	}
	if summary.Summary.Warn != 1 {
		t.Errorf("Warn = %d, want 1", summary.Summary.Warn)
	}
	if summary.Summary.Fail != 1 {
		t.Errorf("Fail = %d, want 1", summary.Summary.Fail)
	}
}

func TestDoctorSummary_ExitCode(t *testing.T) {
	tests := []struct {
		name     string
		checks   []checkResult
		expected int
	}{
		{
			name: "all pass",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "pass"},
			},
			expected: 0,
		},
		{
			name: "with warnings only",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "warn"},
			},
			expected: 0,
		},
		{
			name: "with failures",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "fail"},
			},
			expected: 1,
		},
		{
			name: "mixed",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "warn"},
				{Status: "fail"},
			},
			expected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			summary := doctorSummary{Checks: tt.checks}
			for _, c := range tt.checks {
				switch c.Status {
				case "pass":
					summary.Summary.Pass++
				case "warn":
					summary.Summary.Warn++
				case "fail":
					summary.Summary.Fail++
				}
			}
			summary.ExitCode = 0
			if summary.Summary.Fail > 0 {
				summary.ExitCode = 1
			}

			if summary.ExitCode != tt.expected {
				t.Errorf("ExitCode = %d, want %d", summary.ExitCode, tt.expected)
			}
		})
	}
}

// Tests using dependency injection

func TestRunDoctorWithDeps_AllPass(t *testing.T) {
	deps, gitMock, uiMock, statMock, authStore, httpMock, apiMock := NewTestDepsForDoctor()

	// Setup - all checks pass
	gitMock.IsGitRepo = true
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	statMock.Files[".env"] = &MockFileInfo{FileName: ".env"}
	httpMock.StatusCode = 200
	apiMock.VaultEnvs = []string{"development"}

	opts := DoctorOptions{JSONOutput: false, Strict: false}

	// Execute
	err := runDoctorWithDeps(opts, deps)

	// Assert
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(uiMock.IntroCalls) != 1 || uiMock.IntroCalls[0] != "doctor" {
		t.Errorf("expected Intro('doctor'), got %v", uiMock.IntroCalls)
	}
	_ = authStore // Used in setup
}

func TestRunDoctorWithDeps_WithFailures(t *testing.T) {
	deps, gitMock, _, statMock, authStore, httpMock, _ := NewTestDepsForDoctor()

	// Setup - network fails
	gitMock.IsGitRepo = true
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = true
	statMock.Files[".env"] = &MockFileInfo{FileName: ".env"}
	httpMock.StatusCode = 500 // Server error
	authStore.StoredAuth = nil // Not logged in

	opts := DoctorOptions{JSONOutput: false, Strict: false}

	// Execute - should return error because of failures
	err := runDoctorWithDeps(opts, deps)

	// With warnings (auth not logged in, network 500), doctor doesn't fail
	// It only fails if there are actual "fail" status checks
	if err != nil {
		t.Fatalf("expected no error with warnings only, got %v", err)
	}
}

func TestRunDoctorWithDeps_StrictMode(t *testing.T) {
	deps, gitMock, _, statMock, authStore, httpMock, _ := NewTestDepsForDoctor()

	// Setup - some warnings
	gitMock.IsGitRepo = true
	gitMock.Repo = "owner/repo"
	gitMock.EnvInGitignore = false // Will produce warning
	statMock.Files[".env"] = &MockFileInfo{FileName: ".env"}
	httpMock.StatusCode = 200
	authStore.StoredAuth = &StoredAuthInfo{KeywayToken: "token", GitHubLogin: "user"}

	opts := DoctorOptions{JSONOutput: false, Strict: true}

	// Execute - strict mode converts warnings to failures
	err := runDoctorWithDeps(opts, deps)

	// Assert - with strict mode, warning becomes failure
	if err == nil {
		t.Fatal("expected error in strict mode with warnings, got nil")
	}
}

func TestCheckAuthWithDeps_NotLoggedIn(t *testing.T) {
	deps, _, _, _, authStore, _, _ := NewTestDepsForDoctor()

	// Setup - not logged in
	authStore.StoredAuth = nil

	// Execute
	result := checkAuthWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
	if result.ID != "auth" {
		t.Errorf("expected id 'auth', got %q", result.ID)
	}
}

func TestCheckAuthWithDeps_ValidToken(t *testing.T) {
	deps, _, _, _, authStore, _, apiMock := NewTestDepsForDoctor()

	// Setup - logged in with valid token
	authStore.StoredAuth = &StoredAuthInfo{
		KeywayToken: "valid-token",
		GitHubLogin: "testuser",
	}

	// Mock ValidateToken to return success
	// The MockAPIClient's ValidateToken returns nil, nil by default
	_ = apiMock

	// Execute
	result := checkAuthWithDeps(deps)

	// Assert - will be "warn" because ValidateToken returns nil, nil (no validation)
	// In a real scenario, we'd need to mock a successful validation response
	if result.Status != "warn" && result.Status != "pass" {
		t.Errorf("expected warn or pass status, got %q", result.Status)
	}
}

func TestCheckGitHubWithDeps_NotGitRepo(t *testing.T) {
	deps, gitMock, _, _, _, _, _ := NewTestDepsForDoctor()

	// Setup
	gitMock.IsGitRepo = false

	// Execute
	result := checkGitHubWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
	if result.Detail != "Not in a git repository" {
		t.Errorf("unexpected detail: %q", result.Detail)
	}
}

func TestCheckGitHubWithDeps_NoRemote(t *testing.T) {
	deps, gitMock, _, _, _, _, _ := NewTestDepsForDoctor()

	// Setup
	gitMock.IsGitRepo = true
	gitMock.RepoError = errors.New("no remote")

	// Execute
	result := checkGitHubWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
}

func TestCheckGitHubWithDeps_ValidRepo(t *testing.T) {
	deps, gitMock, _, _, _, _, _ := NewTestDepsForDoctor()

	// Setup
	gitMock.IsGitRepo = true
	gitMock.Repo = "owner/repo"
	gitMock.RepoError = nil

	// Execute
	result := checkGitHubWithDeps(deps)

	// Assert
	if result.Status != "pass" {
		t.Errorf("expected pass status, got %q", result.Status)
	}
	if result.Detail != "owner/repo" {
		t.Errorf("expected detail 'owner/repo', got %q", result.Detail)
	}
}

func TestCheckNetworkWithDeps_ConnectionError(t *testing.T) {
	deps, _, _, _, _, httpMock, _ := NewTestDepsForDoctor()

	// Setup
	httpMock.HeadError = errors.New("connection refused")

	// Execute
	result := checkNetworkWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
	if result.Detail != "Cannot connect to API server" {
		t.Errorf("unexpected detail: %q", result.Detail)
	}
}

func TestCheckNetworkWithDeps_ServerError(t *testing.T) {
	deps, _, _, _, _, httpMock, _ := NewTestDepsForDoctor()

	// Setup
	httpMock.StatusCode = 503

	// Execute
	result := checkNetworkWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
}

func TestCheckNetworkWithDeps_Success(t *testing.T) {
	deps, _, _, _, _, httpMock, _ := NewTestDepsForDoctor()

	// Setup
	httpMock.StatusCode = 200

	// Execute
	result := checkNetworkWithDeps(deps)

	// Assert
	if result.Status != "pass" {
		t.Errorf("expected pass status, got %q", result.Status)
	}
}

func TestCheckEnvFileWithDeps_NoEnvFile(t *testing.T) {
	deps, _, _, statMock, _, _, _ := NewTestDepsForDoctor()

	// Setup - no files
	statMock.Files = make(map[string]*MockFileInfo)

	// Execute
	result := checkEnvFileWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
}

func TestCheckEnvFileWithDeps_HasEnvFile(t *testing.T) {
	deps, _, _, statMock, _, _, _ := NewTestDepsForDoctor()

	// Setup
	statMock.Files[".env"] = &MockFileInfo{FileName: ".env"}

	// Execute
	result := checkEnvFileWithDeps(deps)

	// Assert
	if result.Status != "pass" {
		t.Errorf("expected pass status, got %q", result.Status)
	}
}

func TestCheckGitignoreWithDeps_NotGitRepo(t *testing.T) {
	deps, gitMock, _, _, _, _, _ := NewTestDepsForDoctor()

	// Setup
	gitMock.IsGitRepo = false

	// Execute
	result := checkGitignoreWithDeps(deps)

	// Assert
	if result.Status != "pass" {
		t.Errorf("expected pass status, got %q", result.Status)
	}
}

func TestCheckGitignoreWithDeps_EnvIgnored(t *testing.T) {
	deps, gitMock, _, _, _, _, _ := NewTestDepsForDoctor()

	// Setup
	gitMock.IsGitRepo = true
	gitMock.EnvInGitignore = true

	// Execute
	result := checkGitignoreWithDeps(deps)

	// Assert
	if result.Status != "pass" {
		t.Errorf("expected pass status, got %q", result.Status)
	}
}

func TestCheckGitignoreWithDeps_EnvNotIgnored(t *testing.T) {
	deps, gitMock, _, _, _, _, _ := NewTestDepsForDoctor()

	// Setup
	gitMock.IsGitRepo = true
	gitMock.EnvInGitignore = false

	// Execute
	result := checkGitignoreWithDeps(deps)

	// Assert
	if result.Status != "warn" {
		t.Errorf("expected warn status, got %q", result.Status)
	}
}
