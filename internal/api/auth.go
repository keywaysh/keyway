package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/keywaysh/cli/internal/config"
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
	Login     string      `json:"login"`
	Username  string      `json:"username"`
	GitHubID  interface{} `json:"githubId,omitempty"` // Can be string or number
	Plan      string      `json:"plan,omitempty"`
	CreatedAt string      `json:"createdAt,omitempty"`
}

// GitHubAppInstallationStatus is the status of GitHub App installation
type GitHubAppInstallationStatus struct {
	Installed      bool   `json:"installed"`
	InstallationID int    `json:"installationId,omitempty"`
	InstallURL     string `json:"installUrl"`
	Message        string `json:"message,omitempty"`
}

// RepoIds contains GitHub repository IDs for deep linking
type RepoIds struct {
	OwnerID int `json:"ownerId"`
	RepoID  int `json:"repoId"`
}

// GetRepoIdsFromBackend fetches repo IDs from the backend
// Works for private repos if GitHub App is installed with "all repos" on the org
func (c *Client) GetRepoIdsFromBackend(ctx context.Context, repoFullName string) (*RepoIds, error) {
	var wrapper struct {
		Data struct {
			OwnerID *int `json:"ownerId"`
			RepoID  *int `json:"repoId"`
		} `json:"data"`
	}

	path := fmt.Sprintf("/v1/github/repo-ids?repo=%s", url.QueryEscape(repoFullName))
	err := c.do(ctx, "GET", path, nil, &wrapper)
	if err != nil {
		return nil, err
	}

	if wrapper.Data.OwnerID == nil || wrapper.Data.RepoID == nil {
		return nil, nil
	}

	return &RepoIds{
		OwnerID: *wrapper.Data.OwnerID,
		RepoID:  *wrapper.Data.RepoID,
	}, nil
}

// GetRepoIdsFromGitHub fetches repo IDs from GitHub public API
// Only works for public repos (no auth required)
func GetRepoIdsFromGitHub(ctx context.Context, owner, repo string) (*RepoIds, error) {
	url := fmt.Sprintf("%s/repos/%s/%s", config.GetGitHubAPIURL(), owner, repo)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "keyway-cli")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Repo is private or doesn't exist
		return nil, nil
	}

	var data struct {
		ID    int `json:"id"`
		Owner struct {
			ID int `json:"id"`
		} `json:"owner"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	return &RepoIds{
		OwnerID: data.Owner.ID,
		RepoID:  data.ID,
	}, nil
}

// StartDeviceLogin initiates the device login flow
func (c *Client) StartDeviceLogin(ctx context.Context, repository string, repoIds *RepoIds) (*DeviceStartResponse, error) {
	body := map[string]interface{}{}
	if repository != "" {
		body["repository"] = repository
	}
	if repoIds != nil {
		body["ownerId"] = repoIds.OwnerID
		body["repoId"] = repoIds.RepoID
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
