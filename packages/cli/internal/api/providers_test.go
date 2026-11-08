package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The URL opened in the browser for a provider OAuth flow must not carry the CLI's
// token (it lands in server logs, analytics and browser history): the CLI asks the API
// for a single-use ticket URL with its Bearer token instead.
func TestCreateProviderAuthURL_RequestsTicketWithBearerToken(t *testing.T) {
	const cliToken = "secret-cli-jwt"
	const ticketURL = "https://api.keyway.sh/v1/integrations/vercel/authorize?ticket=payload.sig"

	var gotMethod, gotPath, gotAuth, gotQuery string
	var gotBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		gotBody, _ = io.ReadAll(r.Body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"url": ticketURL, "expiresIn": 60},
		})
	}))
	defer server.Close()

	client := NewClient(cliToken)
	client.baseURL = server.URL

	authURL, err := client.CreateProviderAuthURL(context.Background(), "vercel")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/v1/integrations/vercel/authorize-ticket" {
		t.Errorf("path = %s", gotPath)
	}
	if gotQuery != "" {
		t.Errorf("request must not carry a query string, got %q", gotQuery)
	}
	if gotAuth != "Bearer "+cliToken {
		t.Errorf("Authorization = %q", gotAuth)
	}
	// Fastify rejects an empty body sent as application/json
	if !json.Valid(gotBody) {
		t.Errorf("body must be valid JSON, got %q", gotBody)
	}
	if authURL != ticketURL {
		t.Errorf("url = %q, want %q", authURL, ticketURL)
	}
	if strings.Contains(authURL, cliToken) {
		t.Error("the URL opened in the browser must not contain the CLI token")
	}
}

func TestCreateProviderAuthURL_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"detail": "Provider unknown not found"})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	authURL, err := client.CreateProviderAuthURL(context.Background(), "unknown")
	if err == nil {
		t.Fatal("expected an error")
	}
	if authURL != "" {
		t.Errorf("url = %q, want empty", authURL)
	}
}

func TestCreateProviderAuthURL_RejectsMissingOrNonHTTPURL(t *testing.T) {
	for _, returned := range []string{"", "javascript:alert(1)", "file:///etc/passwd"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"url": returned}})
		}))

		client := NewClient("token")
		client.baseURL = server.URL

		authURL, err := client.CreateProviderAuthURL(context.Background(), "vercel")
		server.Close()
		if err == nil {
			t.Errorf("returned %q: expected an error", returned)
		}
		if authURL != "" {
			t.Errorf("returned %q: url = %q, want empty", returned, authURL)
		}
	}
}
