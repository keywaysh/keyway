package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_PushSecrets_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/secrets/push" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		if body["environment"] != "production" {
			t.Errorf("expected environment 'production', got '%v'", body["environment"])
		}
		secrets := body["secrets"].(map[string]interface{})
		if len(secrets) != 2 {
			t.Errorf("expected 2 secrets, got %d", len(secrets))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"success": true,
				"message": "Secrets pushed",
				"stats": map[string]interface{}{
					"created": 1,
					"updated": 1,
					"deleted": 0,
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	secrets := map[string]string{
		"API_KEY":     "secret123",
		"DB_PASSWORD": "dbpass",
	}

	resp, err := client.PushSecrets(context.Background(), "owner/repo", "production", secrets)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Stats == nil {
		t.Fatal("expected stats, got nil")
	}
	if resp.Stats.Created != 1 {
		t.Errorf("expected created=1, got %d", resp.Stats.Created)
	}
	if resp.Stats.Updated != 1 {
		t.Errorf("expected updated=1, got %d", resp.Stats.Updated)
	}
}

func TestClient_PushSecrets_EmptySecrets(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		secrets := body["secrets"].(map[string]interface{})
		if len(secrets) != 0 {
			t.Errorf("expected 0 secrets, got %d", len(secrets))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"success": true,
				"message": "No secrets to push",
				"stats": map[string]interface{}{
					"created": 0,
					"updated": 0,
					"deleted": 0,
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	resp, err := client.PushSecrets(context.Background(), "owner/repo", "production", map[string]string{})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Stats == nil {
		t.Fatal("expected stats, got nil")
	}
	if resp.Stats.Created != 0 {
		t.Errorf("expected created=0, got %d", resp.Stats.Created)
	}
}

func TestClient_PushSecrets_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "Invalid token",
		})
	}))
	defer server.Close()

	client := NewClient("bad-token")
	client.baseURL = server.URL

	_, err := client.PushSecrets(context.Background(), "owner/repo", "production", map[string]string{"KEY": "value"})

	if err == nil {
		t.Fatal("expected error for unauthorized request")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != 401 {
		t.Errorf("expected status 401, got %d", apiErr.StatusCode)
	}
}

func TestClient_PushSecrets_Forbidden(t *testing.T) {
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

	_, err := client.PushSecrets(context.Background(), "owner/repo", "production", map[string]string{"KEY": "value"})

	if err == nil {
		t.Fatal("expected error for forbidden request")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.UpgradeURL != "https://keyway.sh/upgrade" {
		t.Errorf("expected upgradeUrl, got '%s'", apiErr.UpgradeURL)
	}
}

func TestClient_PullSecrets_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}

		// Check query params
		if r.URL.Query().Get("environment") != "staging" {
			t.Errorf("expected environment=staging, got %s", r.URL.Query().Get("environment"))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"content": "API_KEY=secret123\nDB_URL=postgres://localhost",
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	resp, err := client.PullSecrets(context.Background(), "owner/repo", "staging")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Content == "" {
		t.Error("expected content, got empty string")
	}
	if resp.Content != "API_KEY=secret123\nDB_URL=postgres://localhost" {
		t.Errorf("unexpected content: %s", resp.Content)
	}
}

func TestClient_PullSecrets_EmptyVault(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"content": "",
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	resp, err := client.PullSecrets(context.Background(), "owner/repo", "production")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Content != "" {
		t.Errorf("expected empty content, got '%s'", resp.Content)
	}
}

func TestClient_PullSecrets_VaultNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "Vault not found",
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	_, err := client.PullSecrets(context.Background(), "owner/nonexistent", "production")

	if err == nil {
		t.Fatal("expected error for vault not found")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != 404 {
		t.Errorf("expected status 404, got %d", apiErr.StatusCode)
	}
}

func TestClient_PullSecrets_NoRepoAccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{
			"detail": "You don't have access to this repository",
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	_, err := client.PullSecrets(context.Background(), "other/private-repo", "production")

	if err == nil {
		t.Fatal("expected error for no repo access")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != 403 {
		t.Errorf("expected status 403, got %d", apiErr.StatusCode)
	}
}

func TestClient_PushSecrets_SpecialCharacters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		// Verify special characters are preserved
		secrets := body["secrets"].(map[string]interface{})
		if secrets["SPECIAL"] != "value=with=equals&and&ampersand" {
			t.Errorf("special characters not preserved: got '%v'", secrets["SPECIAL"])
		}
		if secrets["MULTILINE"] != "line1\nline2\nline3" {
			t.Errorf("multiline not preserved: got '%v'", secrets["MULTILINE"])
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"success": true,
				"message": "Secrets pushed",
				"stats": map[string]interface{}{
					"created": 2,
					"updated": 0,
					"deleted": 0,
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	secrets := map[string]string{
		"SPECIAL":   "value=with=equals&and&ampersand",
		"MULTILINE": "line1\nline2\nline3",
	}

	_, err := client.PushSecrets(context.Background(), "owner/repo", "production", secrets)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
