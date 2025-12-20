package api

import (
	"context"
	"fmt"
)

// InitVaultResponse is the response from initializing a vault
type InitVaultResponse struct {
	VaultID      string `json:"vaultId"`
	RepoFullName string `json:"repoFullName"`
	Message      string `json:"message"`
}

// VaultInfo contains information about a vault
type VaultInfo struct {
	ID           string   `json:"id"`
	RepoFullName string   `json:"repoFullName"`
	Environments []string `json:"environments"`
}

// InitVault creates a new vault for a repository
func (c *Client) InitVault(ctx context.Context, repoFullName string) (*InitVaultResponse, error) {
	body := map[string]string{
		"repoFullName": repoFullName,
	}

	var wrapper struct {
		Data InitVaultResponse `json:"data"`
	}
	err := c.do(ctx, "POST", "/v1/vaults", body, &wrapper)
	return &wrapper.Data, err
}

// CheckVaultExists checks if a vault exists for a repository
func (c *Client) CheckVaultExists(ctx context.Context, repoFullName string) (bool, error) {
	owner, repo := splitRepo(repoFullName)
	if owner == "" || repo == "" {
		return false, fmt.Errorf("invalid repository format: %s", repoFullName)
	}

	path := fmt.Sprintf("/v1/vaults/%s/%s", owner, repo)
	err := c.do(ctx, "GET", path, nil, nil)
	if err != nil {
		if apiErr, ok := err.(*APIError); ok && apiErr.StatusCode == 404 {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// GetVaultEnvironments returns the environments for a vault
func (c *Client) GetVaultEnvironments(ctx context.Context, repoFullName string) ([]string, error) {
	owner, repo := splitRepo(repoFullName)
	if owner == "" || repo == "" {
		return []string{"production"}, nil
	}

	path := fmt.Sprintf("/v1/vaults/%s/%s", owner, repo)
	var wrapper struct {
		Data struct {
			Environments []string `json:"environments"`
		} `json:"data"`
	}

	err := c.do(ctx, "GET", path, nil, &wrapper)
	if err != nil {
		return []string{"production"}, nil
	}

	if len(wrapper.Data.Environments) == 0 {
		return []string{"production"}, nil
	}
	return wrapper.Data.Environments, nil
}

// splitRepo splits "owner/repo" into owner and repo
func splitRepo(repoFullName string) (string, string) {
	for i, c := range repoFullName {
		if c == '/' {
			return repoFullName[:i], repoFullName[i+1:]
		}
	}
	return "", ""
}
