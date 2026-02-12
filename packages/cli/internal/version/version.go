package version

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/config"
)

const (
	// CacheDuration is how long to cache version check results
	CacheDuration = 24 * time.Hour
	// CheckTimeout is the maximum time to wait for version check
	CheckTimeout = 2 * time.Second
)

// UpdateInfo contains information about an available update
type UpdateInfo struct {
	Available      bool
	CurrentVersion string
	LatestVersion  string
	InstallMethod  InstallMethod
	UpdateCommand  string
}

// CheckForUpdate checks if a newer version is available
// Returns nil if no update is available, check is disabled, or on any error
func CheckForUpdate(ctx context.Context, currentVersion string) *UpdateInfo {
	if IsUpdateCheckDisabled() {
		return nil
	}

	// Skip update check for self-hosted instances
	if config.IsCustomAPIURL() {
		return nil
	}

	// Skip check for dev builds
	if currentVersion == "dev" || currentVersion == "" {
		return nil
	}

	// Detect install method once
	method := DetectInstallMethod()

	// Skip check for npx (always fetches latest)
	if method == InstallMethodNPX {
		return nil
	}

	// Check cache first
	cached, err := LoadCache()
	if err == nil && cached != nil && time.Since(cached.LastCheck) < CacheDuration {
		return buildUpdateInfo(currentVersion, cached.LatestVersion, cached.InstallMethod)
	}

	// Fetch from GitHub
	latest, err := FetchLatestVersion(ctx)
	if err != nil {
		return nil // Silent failure
	}

	// Save to cache (ignore errors)
	_ = SaveCache(&CacheData{
		LastCheck:     time.Now(),
		LatestVersion: latest,
		InstallMethod: method,
	})

	return buildUpdateInfo(currentVersion, latest, method)
}

func buildUpdateInfo(current, latest string, method InstallMethod) *UpdateInfo {
	if !IsNewerVersion(latest, current) {
		return nil
	}

	return &UpdateInfo{
		Available:      true,
		CurrentVersion: current,
		LatestVersion:  latest,
		InstallMethod:  method,
		UpdateCommand:  GetUpdateCommand(method),
	}
}

// GetUpdateCommand returns the update command for the given install method.
// Returns an empty string for self-hosted instances where standard update
// commands do not apply.
func GetUpdateCommand(method InstallMethod) string {
	if config.IsCustomAPIURL() {
		return ""
	}

	switch method {
	case InstallMethodNPM:
		return "npm update -g @keywaysh/cli"
	case InstallMethodHomebrew:
		return "brew upgrade keyway"
	default:
		return "curl -fsSL https://keyway.sh/install.sh | sh"
	}
}

// IsNewerVersion returns true if latest is newer than current
// Handles semver format: v1.2.3 or 1.2.3
func IsNewerVersion(latest, current string) bool {
	latestParts := parseVersion(latest)
	currentParts := parseVersion(current)

	if len(latestParts) == 0 || len(currentParts) == 0 {
		return false
	}

	// Compare major, minor, patch
	for i := 0; i < 3; i++ {
		latestPart := 0
		currentPart := 0

		if i < len(latestParts) {
			latestPart = latestParts[i]
		}
		if i < len(currentParts) {
			currentPart = currentParts[i]
		}

		if latestPart > currentPart {
			return true
		}
		if latestPart < currentPart {
			return false
		}
	}

	return false
}

// parseVersion extracts major, minor, patch from a version string
func parseVersion(v string) []int {
	// Strip 'v' prefix
	v = strings.TrimPrefix(v, "v")

	// Handle dirty/dev suffixes
	if idx := strings.IndexAny(v, "-+"); idx != -1 {
		v = v[:idx]
	}

	parts := strings.Split(v, ".")
	result := make([]int, 0, 3)

	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil {
			break
		}
		result = append(result, n)
	}

	return result
}
