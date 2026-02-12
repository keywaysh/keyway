package analytics

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSanitizeProperties_RemovesSensitiveKeys(t *testing.T) {
	props := map[string]interface{}{
		"repo":        "owner/repo",
		"environment": "production",
		"secret":      "should-be-removed",
		"apiSecret":   "should-be-removed",
		"token":       "should-be-removed",
		"authToken":   "should-be-removed",
		"password":    "should-be-removed",
		"dbPassword":  "should-be-removed",
		"content":     "should-be-removed",
		"fileContent": "should-be-removed",
		"key":         "should-be-removed",
		"apiKey":      "should-be-removed",
		"value":       "should-be-removed",
		"secretValue": "should-be-removed",
	}

	result := sanitizeProperties(props)

	// Should keep non-sensitive keys
	if result["repo"] != "owner/repo" {
		t.Errorf("repo should be kept, got %v", result["repo"])
	}
	if result["environment"] != "production" {
		t.Errorf("environment should be kept, got %v", result["environment"])
	}

	// Should remove sensitive keys
	sensitiveKeys := []string{
		"secret", "apiSecret", "token", "authToken",
		"password", "dbPassword", "content", "fileContent",
		"key", "apiKey", "value", "secretValue",
	}
	for _, key := range sensitiveKeys {
		if _, exists := result[key]; exists {
			t.Errorf("sensitive key %q should be removed", key)
		}
	}
}

func TestSanitizeProperties_TruncatesLongStrings(t *testing.T) {
	longString := ""
	for i := 0; i < 600; i++ {
		longString += "a"
	}

	props := map[string]interface{}{
		"longField":  longString,
		"shortField": "short",
	}

	result := sanitizeProperties(props)

	// Long string should be truncated to 200 chars + "..."
	truncated := result["longField"].(string)
	if len(truncated) != 203 { // 200 + "..."
		t.Errorf("long string should be truncated to 203 chars, got %d", len(truncated))
	}
	if truncated[len(truncated)-3:] != "..." {
		t.Errorf("truncated string should end with '...', got %q", truncated[len(truncated)-10:])
	}

	// Short string should be unchanged
	if result["shortField"] != "short" {
		t.Errorf("short string should be unchanged, got %v", result["shortField"])
	}
}

func TestSanitizeProperties_NilInput(t *testing.T) {
	result := sanitizeProperties(nil)

	if result == nil {
		t.Error("should return empty map, not nil")
	}
	if len(result) != 0 {
		t.Errorf("should return empty map, got %v", result)
	}
}

func TestSanitizeProperties_EmptyInput(t *testing.T) {
	result := sanitizeProperties(map[string]interface{}{})

	if len(result) != 0 {
		t.Errorf("should return empty map, got %v", result)
	}
}

func TestSanitizeProperties_PreservesNonStringValues(t *testing.T) {
	props := map[string]interface{}{
		"count":   42,
		"enabled": true,
		"ratio":   3.14,
	}

	result := sanitizeProperties(props)

	if result["count"] != 42 {
		t.Errorf("int should be preserved, got %v", result["count"])
	}
	if result["enabled"] != true {
		t.Errorf("bool should be preserved, got %v", result["enabled"])
	}
	if result["ratio"] != 3.14 {
		t.Errorf("float should be preserved, got %v", result["ratio"])
	}
}

func TestSanitizeProperties_CaseInsensitiveFiltering(t *testing.T) {
	props := map[string]interface{}{
		"SECRET":      "removed",
		"Secret":      "removed",
		"TOKEN":       "removed",
		"Token":       "removed",
		"PASSWORD":    "removed",
		"Password":    "removed",
		"normalField": "kept",
	}

	result := sanitizeProperties(props)

	if _, exists := result["SECRET"]; exists {
		t.Error("SECRET should be removed (case insensitive)")
	}
	if _, exists := result["Secret"]; exists {
		t.Error("Secret should be removed (case insensitive)")
	}
	if _, exists := result["TOKEN"]; exists {
		t.Error("TOKEN should be removed (case insensitive)")
	}
	if result["normalField"] != "kept" {
		t.Error("normalField should be kept")
	}
}

func TestGetDistinctID_Persistence(t *testing.T) {
	// Reset state
	distinctID = ""

	// Create temp dir for config
	tmpDir, err := os.MkdirTemp("", "analytics-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Override config dir for test
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	// Reset distinctID to force new generation
	distinctID = ""

	// First call should generate new ID
	id1 := getDistinctID()
	if id1 == "" {
		t.Error("getDistinctID should return non-empty string")
	}

	// Second call should return same ID (cached)
	id2 := getDistinctID()
	if id1 != id2 {
		t.Errorf("getDistinctID should return same ID: %q != %q", id1, id2)
	}

	// Reset cache and call again - should read from file
	distinctID = ""
	id3 := getDistinctID()
	if id1 != id3 {
		t.Errorf("getDistinctID should read persisted ID: %q != %q", id1, id3)
	}
}

func TestGetDistinctID_Format(t *testing.T) {
	// Reset state
	distinctID = ""

	// Create temp dir
	tmpDir, err := os.MkdirTemp("", "analytics-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	distinctID = ""
	id := getDistinctID()

	// Should be a valid UUID format (36 chars with hyphens)
	if len(id) != 36 {
		t.Errorf("distinctID should be UUID format (36 chars), got %d: %q", len(id), id)
	}
}

func TestGetConfigDir(t *testing.T) {
	dir := getConfigDir()

	if dir == "" {
		t.Error("getConfigDir should return non-empty path")
	}

	if !filepath.IsAbs(dir) {
		t.Errorf("getConfigDir should return absolute path, got %q", dir)
	}

	if filepath.Base(dir) != "keyway" {
		t.Errorf("config dir should end with 'keyway', got %q", dir)
	}
}

func TestSetVersion(t *testing.T) {
	originalVersion := version

	SetVersion("1.2.3")
	if version != "1.2.3" {
		t.Errorf("SetVersion should set version, got %q", version)
	}

	SetVersion("dev")
	if version != "dev" {
		t.Errorf("SetVersion should set version, got %q", version)
	}

	// Restore
	version = originalVersion
}

func TestTrack_DisabledTelemetry(t *testing.T) {
	os.Setenv("KEYWAY_DISABLE_TELEMETRY", "1")
	defer os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	// Should not panic when telemetry is disabled
	Track("test_event", map[string]interface{}{
		"prop": "value",
	})
}

func TestIdentify_DisabledTelemetry(t *testing.T) {
	os.Setenv("KEYWAY_DISABLE_TELEMETRY", "1")
	defer os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	// Should not panic when telemetry is disabled
	Identify("user123", map[string]interface{}{
		"username": "test",
	})
}

func TestShutdown_NoClient(t *testing.T) {
	// Reset client
	client = nil

	// Should not panic when client is nil
	Shutdown()
}
