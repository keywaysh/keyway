package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	client := NewClient("test-token")

	if client == nil {
		t.Fatal("NewClient returned nil")
	}
	if client.token != "test-token" {
		t.Errorf("expected token 'test-token', got '%s'", client.token)
	}
	if client.httpClient == nil {
		t.Error("httpClient is nil")
	}
}

func TestNewClientWithVersion(t *testing.T) {
	client := NewClientWithVersion("test-token", "1.2.3")

	if client.userAgent != "keyway-cli/1.2.3" {
		t.Errorf("expected userAgent 'keyway-cli/1.2.3', got '%s'", client.userAgent)
	}
}

func TestSetTimeout(t *testing.T) {
	client := NewClient("token")
	client.SetTimeout(5 * time.Second)

	if client.httpClient.Timeout != 5*time.Second {
		t.Errorf("expected timeout 5s, got %v", client.httpClient.Timeout)
	}
}

func TestAPIError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      APIError
		expected string
	}{
		{
			name:     "with detail",
			err:      APIError{Detail: "detailed error message"},
			expected: "detailed error message",
		},
		{
			name:     "with title only",
			err:      APIError{Title: "Error Title"},
			expected: "Error Title",
		},
		{
			name:     "with status code only",
			err:      APIError{StatusCode: 404},
			expected: "HTTP 404",
		},
		{
			name:     "detail takes precedence",
			err:      APIError{Detail: "detail", Title: "title", StatusCode: 500},
			expected: "detail",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("expected '%s', got '%s'", tt.expected, got)
			}
		})
	}
}

func TestClient_do_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify headers
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type 'application/json', got '%s'", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("expected Authorization 'Bearer test-token', got '%s'", r.Header.Get("Authorization"))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "success"})
	}))
	defer server.Close()

	client := NewClient("test-token")
	client.baseURL = server.URL

	var result map[string]string
	err := client.do(context.Background(), "GET", "/test", nil, &result)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["message"] != "success" {
		t.Errorf("expected message 'success', got '%s'", result["message"])
	}
}

func TestClient_do_WithBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)

		if body["key"] != "value" {
			t.Errorf("expected body key 'value', got '%s'", body["key"])
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"received": "true"})
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	body := map[string]string{"key": "value"}
	var result map[string]string
	err := client.do(context.Background(), "POST", "/test", body, &result)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClient_do_APIError(t *testing.T) {
	tests := []struct {
		name           string
		statusCode     int
		responseBody   interface{}
		expectedDetail string
	}{
		{
			name:       "400 Bad Request with RFC 7807",
			statusCode: 400,
			responseBody: map[string]string{
				"type":   "validation_error",
				"title":  "Validation Error",
				"detail": "Invalid input provided",
			},
			expectedDetail: "Invalid input provided",
		},
		{
			name:       "401 Unauthorized",
			statusCode: 401,
			responseBody: map[string]string{
				"detail": "Invalid token",
			},
			expectedDetail: "Invalid token",
		},
		{
			name:       "403 Forbidden with upgrade URL",
			statusCode: 403,
			responseBody: map[string]string{
				"detail":     "Plan limit exceeded",
				"upgradeUrl": "https://keyway.sh/upgrade",
			},
			expectedDetail: "Plan limit exceeded",
		},
		{
			name:           "500 Internal Server Error plain text",
			statusCode:     500,
			responseBody:   "Internal Server Error",
			expectedDetail: "Internal Server Error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.statusCode)
				if s, ok := tt.responseBody.(string); ok {
					w.Write([]byte(s))
				} else {
					json.NewEncoder(w).Encode(tt.responseBody)
				}
			}))
			defer server.Close()

			client := NewClient("token")
			client.baseURL = server.URL

			err := client.do(context.Background(), "GET", "/test", nil, nil)

			if err == nil {
				t.Fatal("expected error, got nil")
			}

			apiErr, ok := err.(*APIError)
			if !ok {
				t.Fatalf("expected *APIError, got %T", err)
			}

			if apiErr.StatusCode != tt.statusCode {
				t.Errorf("expected status code %d, got %d", tt.statusCode, apiErr.StatusCode)
			}

			if apiErr.Error() != tt.expectedDetail {
				t.Errorf("expected detail '%s', got '%s'", tt.expectedDetail, apiErr.Error())
			}
		})
	}
}

func TestClient_do_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient("token")
	client.baseURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err := client.do(ctx, "GET", "/test", nil, nil)

	if err == nil {
		t.Fatal("expected error due to cancelled context")
	}
}

func TestClient_do_NoToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("expected no Authorization header when token is empty")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient("")
	client.baseURL = server.URL

	err := client.do(context.Background(), "GET", "/test", nil, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestContains(t *testing.T) {
	tests := []struct {
		s        string
		substr   string
		expected bool
	}{
		{"hello world", "world", true},
		{"hello world", "foo", false},
		{"hello", "hello", true},
		{"", "", true},
		{"hello", "", true},
		{"", "hello", false},
		{"connection refused", "refused", true},
	}

	for _, tt := range tests {
		t.Run(tt.s+"_"+tt.substr, func(t *testing.T) {
			if got := contains(tt.s, tt.substr); got != tt.expected {
				t.Errorf("contains(%q, %q) = %v, want %v", tt.s, tt.substr, got, tt.expected)
			}
		})
	}
}
