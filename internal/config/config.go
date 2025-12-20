package config

import "os"

const (
	// DefaultAPIURL is the production API URL
	DefaultAPIURL = "https://api.keyway.sh"

	// DefaultPostHogHost is the PostHog host
	DefaultPostHogHost = "https://eu.i.posthog.com"
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
