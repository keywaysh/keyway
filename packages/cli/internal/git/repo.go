package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	// SSH format: git@github.com:owner/repo.git
	sshRegex = regexp.MustCompile(`git@github\.com:(.+)/(.+?)(?:\.git)?$`)
	// HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
	httpsRegex = regexp.MustCompile(`https://github\.com/(.+)/(.+?)(?:\.git)?$`)
)

// IsGitRepository checks if the current directory is a git repository
func IsGitRepository() bool {
	cmd := exec.Command("git", "rev-parse", "--is-inside-work-tree")
	cmd.Stderr = nil
	cmd.Stdout = nil
	return cmd.Run() == nil
}

// DetectRepo detects the GitHub repository from git remote
func DetectRepo() (string, error) {
	if !IsGitRepository() {
		return "", fmt.Errorf("not in a git repository")
	}

	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Stderr = nil
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("no remote origin configured")
	}

	remoteURL := strings.TrimSpace(string(output))
	return ParseGitHubURL(remoteURL)
}

// ParseGitHubURL extracts owner/repo from a GitHub URL
func ParseGitHubURL(url string) (string, error) {
	// Try SSH format
	if matches := sshRegex.FindStringSubmatch(url); matches != nil {
		return fmt.Sprintf("%s/%s", matches[1], matches[2]), nil
	}

	// Try HTTPS format
	if matches := httpsRegex.FindStringSubmatch(url); matches != nil {
		return fmt.Sprintf("%s/%s", matches[1], matches[2]), nil
	}

	return "", fmt.Errorf("not a GitHub URL: %s", url)
}

// GetGitRoot returns the root directory of the git repository
func GetGitRoot() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Stderr = nil
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// CheckEnvGitignore checks if .env files are in .gitignore
func CheckEnvGitignore() bool {
	gitRoot, err := GetGitRoot()
	if err != nil {
		return true // Not a git repo, don't warn
	}

	gitignorePath := filepath.Join(gitRoot, ".gitignore")
	content, err := os.ReadFile(gitignorePath)
	if err != nil {
		return false // No .gitignore file
	}

	lines := strings.Split(string(content), "\n")
	patterns := []string{".env", ".env*", ".env.*", "*.env"}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		for _, pattern := range patterns {
			if line == pattern {
				return true
			}
		}
	}

	return false
}

// AddEnvToGitignore adds .env* to .gitignore
func AddEnvToGitignore() error {
	gitRoot, err := GetGitRoot()
	if err != nil {
		return err
	}

	gitignorePath := filepath.Join(gitRoot, ".gitignore")

	// Read existing content
	content, _ := os.ReadFile(gitignorePath)

	newContent := string(content)
	if len(newContent) > 0 && !strings.HasSuffix(newContent, "\n") {
		newContent += "\n"
	}
	newContent += ".env*\n"

	return os.WriteFile(gitignorePath, []byte(newContent), 0644)
}

// MonorepoInfo contains information about detected monorepo setup
type MonorepoInfo struct {
	IsMonorepo bool
	Tool       string // "turborepo", "nx", "pnpm", "lerna", "rush", "yarn", "npm"
}

// DetectMonorepo checks if the repository is a monorepo
// by looking for common monorepo tool configuration files
func DetectMonorepo() MonorepoInfo {
	gitRoot, err := GetGitRoot()
	if err != nil {
		return MonorepoInfo{IsMonorepo: false}
	}

	// Check for monorepo tool config files (in order of popularity)
	monorepoIndicators := []struct {
		file string
		tool string
	}{
		{"turbo.json", "Turborepo"},
		{"nx.json", "Nx"},
		{"pnpm-workspace.yaml", "pnpm workspaces"},
		{"lerna.json", "Lerna"},
		{"rush.json", "Rush"},
	}

	for _, indicator := range monorepoIndicators {
		if _, err := os.Stat(filepath.Join(gitRoot, indicator.file)); err == nil {
			return MonorepoInfo{IsMonorepo: true, Tool: indicator.tool}
		}
	}

	// Check package.json for workspaces field (npm/yarn workspaces)
	packageJSONPath := filepath.Join(gitRoot, "package.json")
	if content, err := os.ReadFile(packageJSONPath); err == nil {
		contentStr := string(content)
		// Simple check for "workspaces" field in package.json
		if strings.Contains(contentStr, `"workspaces"`) {
			return MonorepoInfo{IsMonorepo: true, Tool: "npm/yarn workspaces"}
		}
	}

	return MonorepoInfo{IsMonorepo: false}
}
