package api

import (
	"context"
	"net/url"
)

// PushMode says what a push does to secrets missing from its payload.
type PushMode string

const (
	// PushMerge leaves secrets missing from the payload untouched.
	PushMerge PushMode = "merge"
	// PushReplace moves secrets missing from the payload to the trash.
	PushReplace PushMode = "replace"
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
	// Content is the secrets in .env format, which cannot represent every value.
	Content string `json:"content"`
	// Secrets holds the exact values; nil from servers that predate it.
	Secrets map[string]string `json:"secrets,omitempty"`
}

// PushSecrets uploads secrets to the vault
func (c *Client) PushSecrets(ctx context.Context, repo, env string, secrets map[string]string, mode PushMode) (*PushSecretsResponse, error) {
	body := map[string]interface{}{
		"repoFullName": repo,
		"environment":  env,
		"secrets":      secrets,
		"mode":         mode,
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
