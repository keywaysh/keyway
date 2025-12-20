package api

import (
	"context"
	"net/url"
)

// PushSecretsResponse is the response from pushing secrets
type PushSecretsResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Stats   *struct {
		Created int `json:"created"`
		Updated int `json:"updated"`
		Deleted int `json:"deleted"`
	} `json:"stats,omitempty"`
}

// PullSecretsResponse is the response from pulling secrets
type PullSecretsResponse struct {
	Content string `json:"content"`
}

// PushSecrets uploads secrets to the vault
func (c *Client) PushSecrets(ctx context.Context, repo, env string, secrets map[string]string) (*PushSecretsResponse, error) {
	body := map[string]interface{}{
		"repoFullName": repo,
		"environment":  env,
		"secrets":      secrets,
	}

	var wrapper struct {
		Data PushSecretsResponse `json:"data"`
	}
	err := c.do(ctx, "POST", "/v1/secrets/push", body, &wrapper)
	return &wrapper.Data, err
}

// PullSecrets downloads secrets from the vault
func (c *Client) PullSecrets(ctx context.Context, repo, env string) (*PullSecretsResponse, error) {
	params := url.Values{}
	params.Set("repo", repo)
	params.Set("environment", env)

	var wrapper struct {
		Data PullSecretsResponse `json:"data"`
	}
	err := c.do(ctx, "GET", "/v1/secrets/pull?"+params.Encode(), nil, &wrapper)
	return &wrapper.Data, err
}
