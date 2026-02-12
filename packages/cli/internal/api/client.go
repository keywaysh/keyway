package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/config"
)

const (
	defaultTimeout = 30 * time.Second
)

// Client is the Keyway API client
type Client struct {
	baseURL    string
	httpClient *http.Client
	token      string
	userAgent  string
}

// TrialEligibility contains trial information for org repos
type TrialEligibility struct {
	Eligible      bool   `json:"eligible"`
	DaysAvailable int    `json:"daysAvailable"`
	OrgLogin      string `json:"orgLogin"`
	Reason        string `json:"reason,omitempty"`
}

// APIError represents an error from the API (RFC 7807)
type APIError struct {
	StatusCode int               `json:"-"`
	Type       string            `json:"type,omitempty"`
	Title      string            `json:"title,omitempty"`
	Detail     string            `json:"detail,omitempty"`
	UpgradeURL string            `json:"upgradeUrl,omitempty"`
	TrialInfo  *TrialEligibility `json:"trialInfo,omitempty"`
}

func (e *APIError) Error() string {
	if e.Detail != "" {
		return e.Detail
	}
	if e.Title != "" {
		return e.Title
	}
	return fmt.Sprintf("HTTP %d", e.StatusCode)
}

// NewClient creates a new API client
func NewClient(token string) *Client {
	httpClient := &http.Client{
		Timeout: defaultTimeout,
	}

	// Allow insecure TLS for local development (self-signed certs)
	if os.Getenv("KEYWAY_INSECURE") == "1" {
		httpClient.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		}
	}

	return &Client{
		baseURL:    config.GetAPIURL(),
		httpClient: httpClient,
		token:      token,
		userAgent:  "keyway-cli/dev", // Will be set properly at build time
	}
}

// NewClientWithVersion creates a new API client with version
func NewClientWithVersion(token, version string) *Client {
	c := NewClient(token)
	c.userAgent = fmt.Sprintf("keyway-cli/%s", version)
	return c
}

// SetTimeout sets a custom timeout for requests
func (c *Client) SetTimeout(timeout time.Duration) {
	c.httpClient.Timeout = timeout
}

// do performs an HTTP request
func (c *Client) do(ctx context.Context, method, path string, body, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return c.handleNetworkError(err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr APIError
		if err := json.Unmarshal(respBody, &apiErr); err != nil {
			return &APIError{
				StatusCode: resp.StatusCode,
				Detail:     string(respBody),
			}
		}
		apiErr.StatusCode = resp.StatusCode
		return &apiErr
	}

	if result != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("failed to unmarshal response: %w", err)
		}
	}

	return nil
}

// handleNetworkError converts network errors to user-friendly messages
func (c *Client) handleNetworkError(err error) error {
	if os.IsTimeout(err) {
		return fmt.Errorf("connection timed out - check your network connection")
	}
	// Check for common network errors
	errStr := err.Error()
	if strings.Contains(errStr, "no such host") {
		return fmt.Errorf("DNS lookup failed - check your internet connection")
	}
	if strings.Contains(errStr, "connection refused") {
		return fmt.Errorf("connection refused - is the API server running?")
	}
	if strings.Contains(errStr, "certificate") {
		return fmt.Errorf("SSL certificate error - check your system time")
	}
	return fmt.Errorf("network error: %w", err)
}
