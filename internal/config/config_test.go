package config

import (
	"os"
	"testing"
)

func TestGetAPIURL_Default(t *testing.T) {
	// Clear any existing env var
	os.Unsetenv("KEYWAY_API_URL")

	url := GetAPIURL()
	if url != DefaultAPIURL {
		t.Errorf("GetAPIURL() = %v, want %v", url, DefaultAPIURL)
	}
}

func TestGetAPIURL_FromEnv(t *testing.T) {
	customURL := "https://custom-api.keyway.sh"
	os.Setenv("KEYWAY_API_URL", customURL)
	defer os.Unsetenv("KEYWAY_API_URL")

	url := GetAPIURL()
	if url != customURL {
		t.Errorf("GetAPIURL() = %v, want %v", url, customURL)
	}
}

func TestGetAPIURL_EmptyEnv(t *testing.T) {
	os.Setenv("KEYWAY_API_URL", "")
	defer os.Unsetenv("KEYWAY_API_URL")

	url := GetAPIURL()
	if url != DefaultAPIURL {
		t.Errorf("GetAPIURL() with empty env = %v, want %v", url, DefaultAPIURL)
	}
}

func TestIsTelemetryDisabled_NotSet(t *testing.T) {
	os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	if IsTelemetryDisabled() {
		t.Error("IsTelemetryDisabled() should return false when not set")
	}
}

func TestIsTelemetryDisabled_SetToOne(t *testing.T) {
	os.Setenv("KEYWAY_DISABLE_TELEMETRY", "1")
	defer os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	if !IsTelemetryDisabled() {
		t.Error("IsTelemetryDisabled() should return true when set to 1")
	}
}

func TestIsTelemetryDisabled_SetToTrue(t *testing.T) {
	os.Setenv("KEYWAY_DISABLE_TELEMETRY", "true")
	defer os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	if !IsTelemetryDisabled() {
		t.Error("IsTelemetryDisabled() should return true when set to true")
	}
}

func TestIsTelemetryDisabled_SetToZero(t *testing.T) {
	os.Setenv("KEYWAY_DISABLE_TELEMETRY", "0")
	defer os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	if IsTelemetryDisabled() {
		t.Error("IsTelemetryDisabled() should return false when set to 0")
	}
}

func TestIsTelemetryDisabled_SetToEmpty(t *testing.T) {
	os.Setenv("KEYWAY_DISABLE_TELEMETRY", "")
	defer os.Unsetenv("KEYWAY_DISABLE_TELEMETRY")

	if IsTelemetryDisabled() {
		t.Error("IsTelemetryDisabled() should return false when set to empty")
	}
}

func TestGetToken_NotSet(t *testing.T) {
	os.Unsetenv("KEYWAY_TOKEN")

	token := GetToken()
	if token != "" {
		t.Errorf("GetToken() = %v, want empty string", token)
	}
}

func TestGetToken_Set(t *testing.T) {
	os.Setenv("KEYWAY_TOKEN", "test-token-123")
	defer os.Unsetenv("KEYWAY_TOKEN")

	token := GetToken()
	if token != "test-token-123" {
		t.Errorf("GetToken() = %v, want test-token-123", token)
	}
}

func TestIsCI_NotSet(t *testing.T) {
	os.Unsetenv("CI")

	if IsCI() {
		t.Error("IsCI() should return false when CI not set")
	}
}

func TestIsCI_SetToTrue(t *testing.T) {
	os.Setenv("CI", "true")
	defer os.Unsetenv("CI")

	if !IsCI() {
		t.Error("IsCI() should return true when CI=true")
	}
}

func TestIsCI_SetToOne(t *testing.T) {
	os.Setenv("CI", "1")
	defer os.Unsetenv("CI")

	if !IsCI() {
		t.Error("IsCI() should return true when CI=1")
	}
}

func TestDefaultAPIURL(t *testing.T) {
	if DefaultAPIURL != "https://api.keyway.sh" {
		t.Errorf("DefaultAPIURL = %v, want https://api.keyway.sh", DefaultAPIURL)
	}
}
