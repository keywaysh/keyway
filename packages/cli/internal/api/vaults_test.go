package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_InitVault_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/vaults" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)

		if body["repoFullName"] != "owner/repo" {
			t.Errorf("expected repoFullName 'owner/repo', got '%s'", body["repoFullName"])
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"vaultId":      "vault-123",
				"repoFullName": "owner/repo",
				"message":      "Vault created",
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	resp, err := client.InitVault(context.Background(), "owner/repo")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.VaultID != "vault-123" {
		t.Errorf("expected vaultId 'vault-123', got '%s'", resp.VaultID)
	}
}

func TestClient_InitVault_AlreadyExists(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "Vault already exists",
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	_, err := client.InitVault(context.Background(), "owner/repo")

	if err == nil {
		t.Fatal("expected error for conflict")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != 409 {
		t.Errorf("expected status 409, got %d", apiErr.StatusCode)
	}
}

func TestClient_InitVault_Forbidden(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{
			"detail":     "Plan limit exceeded",
			"upgradeUrl": "https://keyway.sh/upgrade",
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	_, err := client.InitVault(context.Background(), "owner/repo")

	if err == nil {
		t.Fatal("expected error for forbidden")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.UpgradeURL != "https://keyway.sh/upgrade" {
		t.Errorf("expected upgradeUrl, got '%s'", apiErr.UpgradeURL)
	}
}

func TestClient_CheckVaultExists_Exists(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/vaults/owner/repo" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"id":           "vault-123",
				"repoFullName": "owner/repo",
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	exists, err := client.CheckVaultExists(context.Background(), "owner/repo")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !exists {
		t.Error("expected vault to exist")
	}
}

func TestClient_CheckVaultExists_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "Vault not found",
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	exists, err := client.CheckVaultExists(context.Background(), "owner/nonexistent")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if exists {
		t.Error("expected vault to not exist")
	}
}

func TestClient_CheckVaultExists_InvalidFormat(t *testing.T) {
	client := NewClient("token")

	_, err := client.CheckVaultExists(context.Background(), "invalid-format")

	if err == nil {
		t.Fatal("expected error for invalid format")
	}
}

func TestClient_GetVaultEnvironments_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"environments": []string{"production", "staging", "development"},
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	envs, err := client.GetVaultEnvironments(context.Background(), "owner/repo")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(envs) != 3 {
		t.Errorf("expected 3 environments, got %d", len(envs))
	}
}

func TestClient_GetVaultEnvironments_Empty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"environments": []string{},
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	envs, err := client.GetVaultEnvironments(context.Background(), "owner/repo")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should default to production when empty
	if len(envs) != 1 || envs[0] != "production" {
		t.Errorf("expected default production, got %v", envs)
	}
}

func TestClient_GetVaultEnvironments_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "Vault not found",
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	envs, err := client.GetVaultEnvironments(context.Background(), "owner/repo")

	// Should return default production on error
	if err != nil {
		t.Fatalf("should not error, should return default: %v", err)
	}
	if len(envs) != 1 || envs[0] != "production" {
		t.Errorf("expected default production on error, got %v", envs)
	}
}

func TestSplitRepo(t *testing.T) {
	tests := []struct {
		input         string
		expectedOwner string
		expectedRepo  string
	}{
		{"owner/repo", "owner", "repo"},
		{"my-org/my-repo", "my-org", "my-repo"},
		{"owner/repo-with-dashes", "owner", "repo-with-dashes"},
		{"invalid", "", ""},
		{"", "", ""},
		{"a/b/c", "a", "b/c"}, // Only splits on first /
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			owner, repo := splitRepo(tt.input)
			if owner != tt.expectedOwner {
				t.Errorf("splitRepo(%q) owner = %q, want %q", tt.input, owner, tt.expectedOwner)
			}
			if repo != tt.expectedRepo {
				t.Errorf("splitRepo(%q) repo = %q, want %q", tt.input, repo, tt.expectedRepo)
			}
		})
	}
}
