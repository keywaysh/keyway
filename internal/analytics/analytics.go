package analytics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/keywaysh/cli/internal/config"
	"github.com/posthog/posthog-go"
)

// Events constants for analytics tracking
const (
	// Core commands
	EventLogin      = "cli_login"
	EventInit       = "cli_init"
	EventPush       = "cli_push"
	EventPull       = "cli_pull"
	EventDiff       = "cli_diff"
	EventDoctor     = "cli_doctor"
	EventScan       = "cli_scan"

	// Provider integration
	EventConnect    = "cli_connect"
	EventDisconnect = "cli_disconnect"
	EventSync       = "cli_sync"

	// Growth & conversion
	EventReadmeBadge   = "cli_readme_badge"
	EventUpgradePrompt = "cli_upgrade_prompt"

	// Errors & performance
	EventError          = "cli_error"
	EventCommandLatency = "cli_command_latency"
)

var (
	client     posthog.Client
	distinctID string
	initOnce   sync.Once
	mu         sync.Mutex
	version    = "dev" // Set via build flags
)

// SetVersion sets the CLI version for analytics
func SetVersion(v string) {
	version = v
}

type idConfig struct {
	DistinctID string `json:"distinctId"`
}

func getConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "keyway")
}

func getIDFilePath() string {
	return filepath.Join(getConfigDir(), "id.json")
}

// getDistinctID returns a persistent anonymous ID for analytics
func getDistinctID() string {
	mu.Lock()
	defer mu.Unlock()

	if distinctID != "" {
		return distinctID
	}

	configDir := getConfigDir()
	idFile := getIDFilePath()

	// Try to read existing ID
	if data, err := os.ReadFile(idFile); err == nil {
		var cfg idConfig
		if err := json.Unmarshal(data, &cfg); err == nil && cfg.DistinctID != "" {
			distinctID = cfg.DistinctID
			return distinctID
		}
	}

	// Create new ID
	distinctID = uuid.New().String()

	// Persist it
	if err := os.MkdirAll(configDir, 0700); err == nil {
		cfg := idConfig{DistinctID: distinctID}
		if data, err := json.MarshalIndent(cfg, "", "  "); err == nil {
			_ = os.WriteFile(idFile, data, 0600)
		}
	}

	return distinctID
}

// initClient initializes the PostHog client
func initClient() {
	if config.IsTelemetryDisabled() {
		return
	}

	apiKey := config.GetPostHogKey()
	if apiKey == "" {
		return
	}

	var err error
	client, err = posthog.NewWithConfig(apiKey, posthog.Config{
		Endpoint: config.GetPostHogHost(),
	})
	if err != nil {
		client = nil
	}
}

// sanitizeProperties removes sensitive data from properties
func sanitizeProperties(properties map[string]interface{}) map[string]interface{} {
	if properties == nil {
		return make(map[string]interface{})
	}

	sanitized := make(map[string]interface{})
	sensitiveKeywords := []string{"secret", "token", "password", "content", "key", "value"}

	for key, value := range properties {
		keyLower := strings.ToLower(key)
		isSensitive := false

		for _, keyword := range sensitiveKeywords {
			if strings.Contains(keyLower, keyword) {
				isSensitive = true
				break
			}
		}

		if isSensitive {
			continue
		}

		// Truncate large strings
		if str, ok := value.(string); ok && len(str) > 500 {
			sanitized[key] = str[:200] + "..."
			continue
		}

		sanitized[key] = value
	}

	return sanitized
}

// Track sends an analytics event to PostHog
func Track(event string, properties map[string]interface{}) {
	if config.IsTelemetryDisabled() {
		return
	}

	initOnce.Do(initClient)

	if client == nil {
		return
	}

	sanitized := sanitizeProperties(properties)

	// Add standard properties
	sanitized["source"] = "cli-go"
	sanitized["platform"] = runtime.GOOS
	sanitized["arch"] = runtime.GOARCH
	sanitized["goVersion"] = runtime.Version()
	sanitized["version"] = version
	sanitized["ci"] = config.IsCI()

	_ = client.Enqueue(posthog.Capture{
		DistinctId: getDistinctID(),
		Event:      event,
		Properties: sanitized,
	})
}

// Identify associates the anonymous ID with a user ID
func Identify(userID string, properties map[string]interface{}) {
	if config.IsTelemetryDisabled() {
		return
	}

	initOnce.Do(initClient)

	if client == nil {
		return
	}

	sanitized := sanitizeProperties(properties)
	sanitized["source"] = "cli-go"

	_ = client.Enqueue(posthog.Identify{
		DistinctId: userID,
		Properties: sanitized,
	})

	// Alias the anonymous ID to this user
	anonID := getDistinctID()
	if anonID != "" && anonID != userID {
		_ = client.Enqueue(posthog.Alias{
			DistinctId: userID,
			Alias:      anonID,
		})
	}
}

// Shutdown flushes and closes the PostHog client
func Shutdown() {
	if client != nil {
		_ = client.Close()
	}
}
