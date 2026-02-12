package api

import (
	"context"
	"fmt"
	"net/http"
)

// Provider represents a supported provider
type Provider struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Configured  bool   `json:"configured"`
}

// Connection represents a provider connection
type Connection struct {
	ID             string  `json:"id"`
	Provider       string  `json:"provider"`
	ProviderTeamID *string `json:"providerTeamId,omitempty"`
	CreatedAt      string  `json:"createdAt"`
}

// ConnectTokenResponse represents the response from token-based connection
type ConnectTokenResponse struct {
	Success bool `json:"success"`
	User    struct {
		Username string  `json:"username"`
		TeamName *string `json:"teamName,omitempty"`
	} `json:"user"`
}

// ProviderProject represents a project from a provider
type ProviderProject struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ServiceID    *string  `json:"serviceId,omitempty"`   // Railway: service ID
	ServiceName  *string  `json:"serviceName,omitempty"` // Railway: service name
	LinkedRepo   *string  `json:"linkedRepo,omitempty"`
	Environments []string `json:"environments,omitempty"`
	ConnectionID string   `json:"connectionId"`
	TeamID       *string  `json:"teamId,omitempty"`
	TeamName     *string  `json:"teamName,omitempty"`
}

// SyncDiff represents the difference between Keyway and provider secrets
type SyncDiff struct {
	KeywayCount    int      `json:"keywayCount"`
	ProviderCount  int      `json:"providerCount"`
	OnlyInKeyway   []string `json:"onlyInKeyway"`
	OnlyInProvider []string `json:"onlyInProvider"`
	Different      []string `json:"different"`
	Same           []string `json:"same"`
}

// SyncPreview represents what will change during sync
type SyncPreview struct {
	ToCreate []string `json:"toCreate"`
	ToUpdate []string `json:"toUpdate"`
	ToDelete []string `json:"toDelete"`
	ToSkip   []string `json:"toSkip"`
}

// SyncResult represents the result of a sync operation
type SyncResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	Stats   struct {
		Created int `json:"created"`
		Updated int `json:"updated"`
		Deleted int `json:"deleted"`
	} `json:"stats"`
}

// SyncStatus represents the current sync status
type SyncStatus struct {
	IsFirstSync         bool `json:"isFirstSync"`
	VaultIsEmpty        bool `json:"vaultIsEmpty"`
	ProviderHasSecrets  bool `json:"providerHasSecrets"`
	ProviderSecretCount int  `json:"providerSecretCount"`
}

// ProjectLink represents a link between a vault and a provider project
type ProjectLink struct {
	ID                  string  `json:"id"`
	ProjectID           string  `json:"projectId"`
	ProjectName         *string `json:"projectName"`
	KeywayEnvironment   string  `json:"keywayEnvironment"`
	ProviderEnvironment string  `json:"providerEnvironment"`
	LastSyncedAt        *string `json:"lastSyncedAt"`
	IsNew               bool    `json:"isNew"`
}

// SyncOptions contains options for sync operations
type SyncOptions struct {
	ConnectionID        string  `json:"connectionId"`
	ProjectID           string  `json:"projectId"`
	ServiceID           *string `json:"serviceId,omitempty"`
	KeywayEnvironment   string  `json:"keywayEnvironment"`
	ProviderEnvironment string  `json:"providerEnvironment"`
	Direction           string  `json:"direction,omitempty"` // "push" or "pull"
	AllowDelete         bool    `json:"allowDelete,omitempty"`
}

// GetProviders returns available providers
func (c *Client) GetProviders(ctx context.Context) ([]Provider, error) {
	var wrapper struct {
		Data struct {
			Providers []Provider `json:"providers"`
		} `json:"data"`
	}

	err := c.do(ctx, http.MethodGet, "/v1/integrations", nil, &wrapper)
	if err != nil {
		return nil, err
	}

	return wrapper.Data.Providers, nil
}

// GetConnections returns user's provider connections
func (c *Client) GetConnections(ctx context.Context) ([]Connection, error) {
	var wrapper struct {
		Data struct {
			Connections []Connection `json:"connections"`
		} `json:"data"`
	}

	err := c.do(ctx, http.MethodGet, "/v1/integrations/connections", nil, &wrapper)
	if err != nil {
		return nil, err
	}

	return wrapper.Data.Connections, nil
}

// DeleteConnection removes a provider connection
func (c *Client) DeleteConnection(ctx context.Context, connectionID string) error {
	return c.do(ctx, http.MethodDelete, fmt.Sprintf("/v1/integrations/connections/%s", connectionID), nil, nil)
}

// GetProviderAuthURL returns the OAuth URL for a provider
func (c *Client) GetProviderAuthURL(provider string) string {
	return fmt.Sprintf("%s/v1/integrations/%s/authorize?token=%s", c.baseURL, provider, c.token)
}

// ConnectWithToken connects to a provider using a token (e.g., Railway)
func (c *Client) ConnectWithToken(ctx context.Context, provider, providerToken string) (*ConnectTokenResponse, error) {
	body := map[string]string{
		"token": providerToken,
	}

	var wrapper struct {
		Data ConnectTokenResponse `json:"data"`
	}
	err := c.do(ctx, http.MethodPost, fmt.Sprintf("/v1/integrations/%s/connect", provider), body, &wrapper)
	if err != nil {
		return nil, err
	}

	return &wrapper.Data, nil
}

// GetAllProviderProjects returns all projects from all connections for a provider
func (c *Client) GetAllProviderProjects(ctx context.Context, provider string) ([]ProviderProject, []Connection, error) {
	var wrapper struct {
		Data struct {
			Projects    []ProviderProject `json:"projects"`
			Connections []Connection      `json:"connections"`
		} `json:"data"`
	}

	err := c.do(ctx, http.MethodGet, fmt.Sprintf("/v1/integrations/providers/%s/all-projects", provider), nil, &wrapper)
	if err != nil {
		return nil, nil, err
	}

	return wrapper.Data.Projects, wrapper.Data.Connections, nil
}

// LinkProject links a vault to a provider project without syncing
func (c *Client) LinkProject(ctx context.Context, repo string, opts SyncOptions) (*ProjectLink, error) {
	var wrapper struct {
		Data struct {
			Link ProjectLink `json:"link"`
		} `json:"data"`
	}

	body := map[string]interface{}{
		"connectionId":        opts.ConnectionID,
		"projectId":           opts.ProjectID,
		"keywayEnvironment":   opts.KeywayEnvironment,
		"providerEnvironment": opts.ProviderEnvironment,
	}

	err := c.do(ctx, http.MethodPost, fmt.Sprintf("/v1/integrations/vaults/%s/sync/link", repo), body, &wrapper)
	if err != nil {
		return nil, err
	}

	return &wrapper.Data.Link, nil
}

// GetSyncStatus returns the sync status for a vault/project pair
func (c *Client) GetSyncStatus(ctx context.Context, repo, connectionID, projectID, environment string) (*SyncStatus, error) {
	var wrapper struct {
		Data SyncStatus `json:"data"`
	}

	path := fmt.Sprintf("/v1/integrations/vaults/%s/sync/status?connectionId=%s&projectId=%s&environment=%s",
		repo, connectionID, projectID, environment)

	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	if err != nil {
		return nil, err
	}

	return &wrapper.Data, nil
}

// GetSyncDiff returns the diff between Keyway and provider secrets
func (c *Client) GetSyncDiff(ctx context.Context, repo string, opts SyncOptions) (*SyncDiff, error) {
	var wrapper struct {
		Data SyncDiff `json:"data"`
	}

	// Build query string for GET request
	path := fmt.Sprintf("/v1/integrations/vaults/%s/sync/diff?connectionId=%s&projectId=%s&keywayEnvironment=%s&providerEnvironment=%s",
		repo, opts.ConnectionID, opts.ProjectID, opts.KeywayEnvironment, opts.ProviderEnvironment)
	if opts.ServiceID != nil {
		path += fmt.Sprintf("&serviceId=%s", *opts.ServiceID)
	}

	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	if err != nil {
		return nil, err
	}

	return &wrapper.Data, nil
}

// GetSyncPreview returns what will change during sync
func (c *Client) GetSyncPreview(ctx context.Context, repo string, opts SyncOptions) (*SyncPreview, error) {
	var wrapper struct {
		Data SyncPreview `json:"data"`
	}

	// Build query string for GET request
	path := fmt.Sprintf("/v1/integrations/vaults/%s/sync/preview?connectionId=%s&projectId=%s&keywayEnvironment=%s&providerEnvironment=%s&direction=%s&allowDelete=%t",
		repo, opts.ConnectionID, opts.ProjectID, opts.KeywayEnvironment, opts.ProviderEnvironment, opts.Direction, opts.AllowDelete)
	if opts.ServiceID != nil {
		path += fmt.Sprintf("&serviceId=%s", *opts.ServiceID)
	}

	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	if err != nil {
		return nil, err
	}

	return &wrapper.Data, nil
}

// ExecuteSync performs the sync operation
func (c *Client) ExecuteSync(ctx context.Context, repo string, opts SyncOptions) (*SyncResult, error) {
	var wrapper struct {
		Data SyncResult `json:"data"`
	}

	body := map[string]interface{}{
		"connectionId":        opts.ConnectionID,
		"projectId":           opts.ProjectID,
		"keywayEnvironment":   opts.KeywayEnvironment,
		"providerEnvironment": opts.ProviderEnvironment,
		"direction":           opts.Direction,
		"allowDelete":         opts.AllowDelete,
	}
	if opts.ServiceID != nil {
		body["serviceId"] = *opts.ServiceID
	}

	err := c.do(ctx, http.MethodPost, fmt.Sprintf("/v1/integrations/vaults/%s/sync", repo), body, &wrapper)
	if err != nil {
		return nil, err
	}

	return &wrapper.Data, nil
}
