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

func TestGetGitHubURL_Default(t *testing.T) {
	os.Unsetenv("KEYWAY_GITHUB_URL")

	url := GetGitHubURL()
	if url != DefaultGitHubBaseURL {
		t.Errorf("GetGitHubURL() = %v, want %v", url, DefaultGitHubBaseURL)
	}
}

func TestGetGitHubURL_FromEnv(t *testing.T) {
	os.Setenv("KEYWAY_GITHUB_URL", "https://github.example.com")
	defer os.Unsetenv("KEYWAY_GITHUB_URL")

	url := GetGitHubURL()
	if url != "https://github.example.com" {
		t.Errorf("GetGitHubURL() = %v, want https://github.example.com", url)
	}
}

func TestGetGitHubURL_TrimsTrailingSlash(t *testing.T) {
	os.Setenv("KEYWAY_GITHUB_URL", "https://github.example.com/")
	defer os.Unsetenv("KEYWAY_GITHUB_URL")

	url := GetGitHubURL()
	if url != "https://github.example.com" {
		t.Errorf("GetGitHubURL() = %v, want https://github.example.com", url)
	}
}

func TestGetGitHubAPIURL_Default(t *testing.T) {
	os.Unsetenv("KEYWAY_GITHUB_API_URL")
	os.Unsetenv("KEYWAY_GITHUB_URL")

	url := GetGitHubAPIURL()
	if url != DefaultGitHubAPIURL {
		t.Errorf("GetGitHubAPIURL() = %v, want %v", url, DefaultGitHubAPIURL)
	}
}

func TestGetGitHubAPIURL_FromEnv(t *testing.T) {
	os.Setenv("KEYWAY_GITHUB_API_URL", "https://api.github.example.com")
	defer os.Unsetenv("KEYWAY_GITHUB_API_URL")

	url := GetGitHubAPIURL()
	if url != "https://api.github.example.com" {
		t.Errorf("GetGitHubAPIURL() = %v, want https://api.github.example.com", url)
	}
}

func TestGetGitHubAPIURL_DerivedFromGHE(t *testing.T) {
	os.Unsetenv("KEYWAY_GITHUB_API_URL")
	os.Setenv("KEYWAY_GITHUB_URL", "https://github.example.com")
	defer os.Unsetenv("KEYWAY_GITHUB_URL")

	url := GetGitHubAPIURL()
	if url != "https://github.example.com/api/v3" {
		t.Errorf("GetGitHubAPIURL() = %v, want https://github.example.com/api/v3", url)
	}
}

func TestGetGitHubAPIURL_ExplicitOverridesGHE(t *testing.T) {
	os.Setenv("KEYWAY_GITHUB_API_URL", "https://custom-api.example.com")
	os.Setenv("KEYWAY_GITHUB_URL", "https://github.example.com")
	defer os.Unsetenv("KEYWAY_GITHUB_API_URL")
	defer os.Unsetenv("KEYWAY_GITHUB_URL")

	url := GetGitHubAPIURL()
	if url != "https://custom-api.example.com" {
		t.Errorf("GetGitHubAPIURL() = %v, want https://custom-api.example.com", url)
	}
}

func TestGetGitHubBaseURL_DelegatesToGetGitHubURL(t *testing.T) {
	os.Unsetenv("KEYWAY_GITHUB_URL")

	if GetGitHubBaseURL() != GetGitHubURL() {
		t.Error("GetGitHubBaseURL() should delegate to GetGitHubURL()")
	}
}

func TestGetDocsURL_Default(t *testing.T) {
	os.Unsetenv("KEYWAY_DOCS_URL")

	url := GetDocsURL()
	if url != DefaultDocsURL {
		t.Errorf("GetDocsURL() = %v, want %v", url, DefaultDocsURL)
	}
}

func TestGetDocsURL_FromEnv(t *testing.T) {
	os.Setenv("KEYWAY_DOCS_URL", "https://docs.example.com")
	defer os.Unsetenv("KEYWAY_DOCS_URL")

	url := GetDocsURL()
	if url != "https://docs.example.com" {
		t.Errorf("GetDocsURL() = %v, want https://docs.example.com", url)
	}
}

func TestIsCustomAPIURL_NotSet(t *testing.T) {
	os.Unsetenv("KEYWAY_API_URL")

	if IsCustomAPIURL() {
		t.Error("IsCustomAPIURL() should return false when not set")
	}
}

func TestIsCustomAPIURL_SetToDefault(t *testing.T) {
	os.Setenv("KEYWAY_API_URL", DefaultAPIURL)
	defer os.Unsetenv("KEYWAY_API_URL")

	if IsCustomAPIURL() {
		t.Error("IsCustomAPIURL() should return false when set to default")
	}
}

func TestIsCustomAPIURL_SetToCustom(t *testing.T) {
	os.Setenv("KEYWAY_API_URL", "https://api.example.com")
	defer os.Unsetenv("KEYWAY_API_URL")

	if !IsCustomAPIURL() {
		t.Error("IsCustomAPIURL() should return true when set to custom URL")
	}
}
