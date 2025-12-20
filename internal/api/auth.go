package api

import (
	"context"
)

// DeviceStartResponse is the response from starting device login
type DeviceStartResponse struct {
	DeviceCode              string `json:"deviceCode"`
	UserCode                string `json:"userCode"`
	VerificationURIComplete string `json:"verificationUriComplete"`
	VerificationURI         string `json:"verificationUri"`
	ExpiresIn               int    `json:"expiresIn"`
	Interval                int    `json:"interval"`
	GitHubAppInstallURL     string `json:"githubAppInstallUrl,omitempty"`
}

// DevicePollResponse is the response from polling device login
type DevicePollResponse struct {
	Status      string `json:"status"` // pending, approved, expired, denied
	KeywayToken string `json:"keywayToken,omitempty"`
	GitHubLogin string `json:"githubLogin,omitempty"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
	Message     string `json:"message,omitempty"`
}

// ValidateTokenResponse is the response from validating a token
type ValidateTokenResponse struct {
	Login    string      `json:"login"`
	Username string      `json:"username"`
	GitHubID interface{} `json:"githubId,omitempty"` // Can be string or number
}

// GitHubAppInstallationStatus is the status of GitHub App installation
type GitHubAppInstallationStatus struct {
	Installed      bool   `json:"installed"`
	InstallationID int    `json:"installationId,omitempty"`
	InstallURL     string `json:"installUrl"`
	Message        string `json:"message,omitempty"`
}

// StartDeviceLogin initiates the device login flow
func (c *Client) StartDeviceLogin(ctx context.Context, repository string) (*DeviceStartResponse, error) {
	body := map[string]interface{}{}
	if repository != "" {
		body["repository"] = repository
	}

	var resp DeviceStartResponse
	err := c.do(ctx, "POST", "/v1/auth/device/start", body, &resp)
	return &resp, err
}

// PollDeviceLogin polls for device login completion
func (c *Client) PollDeviceLogin(ctx context.Context, deviceCode string) (*DevicePollResponse, error) {
	body := map[string]string{"deviceCode": deviceCode}

	var resp DevicePollResponse
	err := c.do(ctx, "POST", "/v1/auth/device/poll", body, &resp)
	return &resp, err
}

// ValidateToken validates the current token
func (c *Client) ValidateToken(ctx context.Context) (*ValidateTokenResponse, error) {
	var wrapper struct {
		Data ValidateTokenResponse `json:"data"`
	}
	err := c.do(ctx, "POST", "/v1/auth/token/validate", map[string]string{}, &wrapper)
	return &wrapper.Data, err
}

// CheckGitHubAppInstallation checks if the GitHub App is installed for a repo
func (c *Client) CheckGitHubAppInstallation(ctx context.Context, repoOwner, repoName string) (*GitHubAppInstallationStatus, error) {
	body := map[string]string{
		"repoOwner": repoOwner,
		"repoName":  repoName,
	}

	var wrapper struct {
		Data GitHubAppInstallationStatus `json:"data"`
	}
	err := c.do(ctx, "POST", "/v1/github/check-installation", body, &wrapper)
	return &wrapper.Data, err
}
