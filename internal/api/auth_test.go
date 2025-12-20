package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_StartDeviceLogin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/auth/device/start" {
			t.Errorf("expected path /v1/auth/device/start, got %s", r.URL.Path)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"deviceCode":              "device-123",
			"userCode":                "ABCD-1234",
			"verificationUri":         "https://keyway.sh/device",
			"verificationUriComplete": "https://keyway.sh/device?code=ABCD-1234",
			"expiresIn":               900,
			"interval":                5,
		})
	}))
	defer server.Close()

	client := NewClient("")
	client.baseURL = server.URL

	resp, err := client.StartDeviceLogin(context.Background(), "")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.DeviceCode != "device-123" {
		t.Errorf("expected deviceCode 'device-123', got '%s'", resp.DeviceCode)
	}
	if resp.UserCode != "ABCD-1234" {
		t.Errorf("expected userCode 'ABCD-1234', got '%s'", resp.UserCode)
	}
	if resp.VerificationURI != "https://keyway.sh/device" {
		t.Errorf("expected verificationUri 'https://keyway.sh/device', got '%s'", resp.VerificationURI)
	}
	if resp.ExpiresIn != 900 {
		t.Errorf("expected expiresIn 900, got %d", resp.ExpiresIn)
	}
	if resp.Interval != 5 {
		t.Errorf("expected interval 5, got %d", resp.Interval)
	}
}

func TestClient_StartDeviceLogin_WithRepository(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)

		if body["repository"] != "owner/repo" {
			t.Errorf("expected repository 'owner/repo', got '%s'", body["repository"])
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"deviceCode":      "device-123",
			"userCode":        "ABCD-1234",
			"verificationUri": "https://keyway.sh/device",
			"expiresIn":       900,
			"interval":        5,
		})
	}))
	defer server.Close()

	client := NewClient("")
	client.baseURL = server.URL

	_, err := client.StartDeviceLogin(context.Background(), "owner/repo")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClient_PollDeviceLogin_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}

		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)

		if body["deviceCode"] != "device-123" {
			t.Errorf("expected deviceCode 'device-123', got '%s'", body["deviceCode"])
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "approved",
			"keywayToken": "kw_token_xyz",
			"githubLogin": "testuser",
		})
	}))
	defer server.Close()

	client := NewClient("")
	client.baseURL = server.URL

	resp, err := client.PollDeviceLogin(context.Background(), "device-123")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Status != "approved" {
		t.Errorf("expected status 'approved', got '%s'", resp.Status)
	}
	if resp.KeywayToken != "kw_token_xyz" {
		t.Errorf("expected keywayToken 'kw_token_xyz', got '%s'", resp.KeywayToken)
	}
	if resp.GitHubLogin != "testuser" {
		t.Errorf("expected githubLogin 'testuser', got '%s'", resp.GitHubLogin)
	}
}

func TestClient_PollDeviceLogin_Pending(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status": "pending",
		})
	}))
	defer server.Close()

	client := NewClient("")
	client.baseURL = server.URL

	resp, err := client.PollDeviceLogin(context.Background(), "device-123")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Status != "pending" {
		t.Errorf("expected status 'pending', got '%s'", resp.Status)
	}
	if resp.KeywayToken != "" {
		t.Errorf("expected empty keywayToken for pending, got '%s'", resp.KeywayToken)
	}
}

func TestClient_PollDeviceLogin_Expired(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "expired",
			"message": "Device code expired",
		})
	}))
	defer server.Close()

	client := NewClient("")
	client.baseURL = server.URL

	resp, err := client.PollDeviceLogin(context.Background(), "device-123")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Status != "expired" {
		t.Errorf("expected status 'expired', got '%s'", resp.Status)
	}
}

func TestClient_ValidateToken_Valid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer valid-token" {
			t.Errorf("expected Authorization 'Bearer valid-token', got '%s'", r.Header.Get("Authorization"))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"login":    "testuser",
				"username": "testuser",
				"githubId": "12345",
			},
		})
	}))
	defer server.Close()

	client := NewClient("valid-token")
	client.baseURL = server.URL

	resp, err := client.ValidateToken(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Username != "testuser" {
		t.Errorf("expected username 'testuser', got '%s'", resp.Username)
	}
}

func TestClient_ValidateToken_Invalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "Invalid token",
		})
	}))
	defer server.Close()

	client := NewClient("invalid-token")
	client.baseURL = server.URL

	_, err := client.ValidateToken(context.Background())

	if err == nil {
		t.Fatal("expected error for invalid token")
	}
}

func TestClient_CheckGitHubAppInstallation_Installed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/github/check-installation" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"installed":  true,
				"installUrl": "",
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	status, err := client.CheckGitHubAppInstallation(context.Background(), "owner", "repo")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !status.Installed {
		t.Error("expected installed=true")
	}
}

func TestClient_CheckGitHubAppInstallation_NotInstalled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"installed":  false,
				"installUrl": "https://github.com/apps/keyway/install",
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	status, err := client.CheckGitHubAppInstallation(context.Background(), "owner", "repo")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status.Installed {
		t.Error("expected installed=false")
	}
	if status.InstallURL != "https://github.com/apps/keyway/install" {
		t.Errorf("expected installUrl, got '%s'", status.InstallURL)
	}
}
