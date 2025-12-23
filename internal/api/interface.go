package api

import "context"

// APIClient defines the interface for the Keyway API client
// This interface enables mocking in tests
type APIClient interface {
	// Auth methods
	StartDeviceLogin(ctx context.Context, repository string, repoIds *RepoIds) (*DeviceStartResponse, error)
	PollDeviceLogin(ctx context.Context, deviceCode string) (*DevicePollResponse, error)
	ValidateToken(ctx context.Context) (*ValidateTokenResponse, error)
	CheckGitHubAppInstallation(ctx context.Context, repoOwner, repoName string) (*GitHubAppInstallationStatus, error)
	GetRepoIdsFromBackend(ctx context.Context, repoFullName string) (*RepoIds, error)

	// Vault methods
	InitVault(ctx context.Context, repoFullName string) (*InitVaultResponse, error)
	CheckVaultExists(ctx context.Context, repoFullName string) (bool, error)
	GetVaultEnvironments(ctx context.Context, repoFullName string) ([]string, error)

	// Secrets methods
	PushSecrets(ctx context.Context, repo, env string, secrets map[string]string) (*PushSecretsResponse, error)
	PullSecrets(ctx context.Context, repo, env string) (*PullSecretsResponse, error)

	// Provider methods
	GetProviders(ctx context.Context) ([]Provider, error)
	GetConnections(ctx context.Context) ([]Connection, error)
	DeleteConnection(ctx context.Context, connectionID string) error
	GetProviderAuthURL(provider string) string
	ConnectWithToken(ctx context.Context, provider, providerToken string) (*ConnectTokenResponse, error)
	GetAllProviderProjects(ctx context.Context, provider string) ([]ProviderProject, []Connection, error)

	// Sync methods
	GetSyncStatus(ctx context.Context, repo, connectionID, projectID, environment string) (*SyncStatus, error)
	GetSyncDiff(ctx context.Context, repo string, opts SyncOptions) (*SyncDiff, error)
	GetSyncPreview(ctx context.Context, repo string, opts SyncOptions) (*SyncPreview, error)
	ExecuteSync(ctx context.Context, repo string, opts SyncOptions) (*SyncResult, error)
}

// Verify that Client implements APIClient
var _ APIClient = (*Client)(nil)
