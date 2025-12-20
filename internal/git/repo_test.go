package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseGitHubURL(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		expected string
		wantErr  bool
	}{
		{
			name:     "HTTPS URL",
			url:      "https://github.com/owner/repo.git",
			expected: "owner/repo",
			wantErr:  false,
		},
		{
			name:     "HTTPS URL without .git",
			url:      "https://github.com/owner/repo",
			expected: "owner/repo",
			wantErr:  false,
		},
		{
			name:     "SSH URL",
			url:      "git@github.com:owner/repo.git",
			expected: "owner/repo",
			wantErr:  false,
		},
		{
			name:     "SSH URL without .git",
			url:      "git@github.com:owner/repo",
			expected: "owner/repo",
			wantErr:  false,
		},
		{
			name:     "Non-GitHub URL",
			url:      "https://gitlab.com/owner/repo.git",
			expected: "",
			wantErr:  true,
		},
		{
			name:     "Bitbucket URL",
			url:      "git@bitbucket.org:owner/repo.git",
			expected: "",
			wantErr:  true,
		},
		{
			name:     "Invalid URL",
			url:      "not-a-url",
			expected: "",
			wantErr:  true,
		},
		{
			name:     "Empty URL",
			url:      "",
			expected: "",
			wantErr:  true,
		},
		{
			name:     "GitHub Enterprise URL",
			url:      "https://github.example.com/owner/repo.git",
			expected: "",
			wantErr:  true,
		},
		{
			name:     "URL with special characters in repo name",
			url:      "https://github.com/owner/repo-name.git",
			expected: "owner/repo-name",
			wantErr:  false,
		},
		{
			name:     "URL with underscores",
			url:      "https://github.com/my_org/my_repo.git",
			expected: "my_org/my_repo",
			wantErr:  false,
		},
		{
			name:     "URL with dots in repo name",
			url:      "https://github.com/owner/repo.js.git",
			expected: "owner/repo.js",
			wantErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseGitHubURL(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseGitHubURL() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.expected {
				t.Errorf("ParseGitHubURL() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestIsGitRepository(t *testing.T) {
	// Test in a non-git directory
	tmpDir, err := os.MkdirTemp("", "non-git-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	if IsGitRepository() {
		t.Error("IsGitRepository() should return false for non-git directory")
	}
}

func TestIsGitRepository_InGitRepo(t *testing.T) {
	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "git-repo-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	if !IsGitRepository() {
		t.Error("IsGitRepository() should return true for git directory")
	}
}

func TestDetectRepo_NoGitDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "non-git-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	_, err = DetectRepo()
	if err == nil {
		t.Error("DetectRepo() should error for non-git directory")
	}
}

func TestDetectRepo_NoRemote(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "git-no-remote-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo without remote
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	_, err = DetectRepo()
	if err == nil {
		t.Error("DetectRepo() should error for repo without remote")
	}
}

func TestDetectRepo_WithGitHubRemote(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "git-github-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmds := [][]string{
		{"git", "init"},
		{"git", "remote", "add", "origin", "https://github.com/testowner/testrepo.git"},
	}

	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = tmpDir
		if err := cmd.Run(); err != nil {
			t.Skipf("git command failed: %v", err)
		}
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	repo, err := DetectRepo()
	if err != nil {
		t.Fatalf("DetectRepo() error: %v", err)
	}
	if repo != "testowner/testrepo" {
		t.Errorf("DetectRepo() = %v, want testowner/testrepo", repo)
	}
}

func TestCheckEnvGitignore_NoGitignore(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "no-gitignore-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	if CheckEnvGitignore() {
		t.Error("CheckEnvGitignore() should return false when no .gitignore exists")
	}
}

func TestCheckEnvGitignore_WithEnvPattern(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "with-gitignore-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	// Create .gitignore with .env pattern
	gitignorePath := filepath.Join(tmpDir, ".gitignore")
	err = os.WriteFile(gitignorePath, []byte(".env\n.env.*\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write .gitignore: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	if !CheckEnvGitignore() {
		t.Error("CheckEnvGitignore() should return true when .env is in .gitignore")
	}
}

func TestCheckEnvGitignore_WithoutEnvPattern(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "no-env-gitignore-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	// Create .gitignore without .env pattern
	gitignorePath := filepath.Join(tmpDir, ".gitignore")
	err = os.WriteFile(gitignorePath, []byte("node_modules/\n*.log\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write .gitignore: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	if CheckEnvGitignore() {
		t.Error("CheckEnvGitignore() should return false when .env is not in .gitignore")
	}
}

func TestAddEnvToGitignore_AppendsToExisting(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "append-gitignore-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	// Create existing .gitignore
	gitignorePath := filepath.Join(tmpDir, ".gitignore")
	err = os.WriteFile(gitignorePath, []byte("node_modules/\n*.log\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write .gitignore: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	err = AddEnvToGitignore()
	if err != nil {
		t.Fatalf("AddEnvToGitignore() error: %v", err)
	}

	content, err := os.ReadFile(".gitignore")
	if err != nil {
		t.Fatalf("failed to read .gitignore: %v", err)
	}

	contentStr := string(content)
	if !strings.Contains(contentStr, "node_modules/") {
		t.Error(".gitignore should still contain node_modules/")
	}
	if !strings.Contains(contentStr, ".env*") {
		t.Error(".gitignore should contain .env*")
	}
}

func TestAddEnvToGitignore_NewFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "new-gitignore-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	err = AddEnvToGitignore()
	if err != nil {
		t.Fatalf("AddEnvToGitignore() error: %v", err)
	}

	content, err := os.ReadFile(".gitignore")
	if err != nil {
		t.Fatalf("failed to read .gitignore: %v", err)
	}

	if !strings.Contains(string(content), ".env*") {
		t.Error(".gitignore should contain .env*")
	}
}

func TestGetGitRoot(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "git-root-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	// Create a subdirectory
	subDir := filepath.Join(tmpDir, "subdir")
	err = os.Mkdir(subDir, 0755)
	if err != nil {
		t.Fatalf("failed to create subdir: %v", err)
	}

	origDir, _ := os.Getwd()
	os.Chdir(subDir)
	defer os.Chdir(origDir)

	root, err := GetGitRoot()
	if err != nil {
		t.Fatalf("GetGitRoot() error: %v", err)
	}

	// Normalize paths for comparison
	expectedRoot, _ := filepath.EvalSymlinks(tmpDir)
	actualRoot, _ := filepath.EvalSymlinks(root)

	if actualRoot != expectedRoot {
		t.Errorf("GetGitRoot() = %v, want %v", actualRoot, expectedRoot)
	}
}

func TestGetGitRoot_NotInGitRepo(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "no-git-root-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	_, err = GetGitRoot()
	if err == nil {
		t.Error("GetGitRoot() should error when not in git repo")
	}
}
