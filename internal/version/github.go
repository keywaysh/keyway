package version

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/keywaysh/cli/internal/config"
)

const (
	defaultGitHubReleasesURL = "https://api.github.com/repos/keywaysh/cli/releases/latest"
)

type githubRelease struct {
	TagName string `json:"tag_name"`
}

// FetchLatestVersion fetches the latest version from GitHub Releases.
// Returns an error if using a custom (self-hosted) API URL, since update
// checks only apply to the official Keyway distribution.
func FetchLatestVersion(ctx context.Context) (string, error) {
	// Skip update checks for self-hosted instances
	if config.IsCustomAPIURL() {
		return "", fmt.Errorf("update checks disabled for self-hosted instances")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", defaultGitHubReleasesURL, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "keyway-cli")

	client := &http.Client{Timeout: CheckTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return "", err
	}

	return release.TagName, nil
}
