package config

import (
	"os"
	"strings"
)

const (
	DefaultAPIURL        = "https://api.keyway.sh"
	DefaultDashboardURL  = "https://app.keyway.sh"
	DefaultPostHogHost   = "https://eu.i.posthog.com"
	DefaultGitHubAPIURL  = "https://api.github.com"
	DefaultGitHubBaseURL = "https://github.com"
	DefaultDocsURL       = "https://docs.keyway.sh"
)

// Blank by default - set via build or env
var (
	PostHogKey = ""
)

// GetAPIURL returns the API URL from env or default
func GetAPIURL() string {
	if url := os.Getenv("KEYWAY_API_URL"); url != "" {
		return url
	}
	return DefaultAPIURL
}

// GetDashboardURL returns the dashboard URL from env or default
func GetDashboardURL() string {
	if url := os.Getenv("KEYWAY_DASHBOARD_URL"); url != "" {
		return url
	}
	return DefaultDashboardURL
}

// GetPostHogHost returns the PostHog host
func GetPostHogHost() string {
	if host := os.Getenv("KEYWAY_POSTHOG_HOST"); host != "" {
		return host
	}
	return DefaultPostHogHost
}

// GetPostHogKey returns the PostHog API key
func GetPostHogKey() string {
	if key := os.Getenv("KEYWAY_POSTHOG_KEY"); key != "" {
		return key
	}
	return PostHogKey
}

// IsTelemetryDisabled returns true if telemetry is disabled
func IsTelemetryDisabled() bool {
	val := os.Getenv("KEYWAY_DISABLE_TELEMETRY")
	return val == "1" || val == "true"
}

// IsCI returns true if running in CI environment
func IsCI() bool {
	ci := os.Getenv("CI")
	return ci == "true" || ci == "1"
}

// GetToken returns the KEYWAY_TOKEN from env (for CI use)
func GetToken() string {
	return os.Getenv("KEYWAY_TOKEN")
}

// GetGitHubURL returns the GitHub base URL from env or default
func GetGitHubURL() string {
	if url := os.Getenv("KEYWAY_GITHUB_URL"); url != "" {
		return strings.TrimSuffix(url, "/")
	}
	return DefaultGitHubBaseURL
}

// GetGitHubAPIURL returns the GitHub API URL from env or default
func GetGitHubAPIURL() string {
	if url := os.Getenv("KEYWAY_GITHUB_API_URL"); url != "" {
		return strings.TrimSuffix(url, "/")
	}
	// If KEYWAY_GITHUB_URL is set (GHE), derive API URL from it
	if ghURL := os.Getenv("KEYWAY_GITHUB_URL"); ghURL != "" {
		ghURL = strings.TrimSuffix(ghURL, "/")
		// For GHE: https://github.example.com -> https://github.example.com/api/v3
		return ghURL + "/api/v3"
	}
	return DefaultGitHubAPIURL
}

// GetGitHubBaseURL returns the GitHub base URL from env or default
// Deprecated: Use GetGitHubURL instead
func GetGitHubBaseURL() string {
	return GetGitHubURL()
}

// GetDocsURL returns the docs URL from env or default
func GetDocsURL() string {
	if url := os.Getenv("KEYWAY_DOCS_URL"); url != "" {
		return url
	}
	return DefaultDocsURL
}

// IsCustomAPIURL returns true if using a non-default API URL (self-hosted)
func IsCustomAPIURL() bool {
	apiURL := os.Getenv("KEYWAY_API_URL")
	return apiURL != "" && apiURL != DefaultAPIURL
}
