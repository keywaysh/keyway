package api

import (
	"context"
	"fmt"
)

// MockClient is a mock implementation of APIClient for testing
type MockClient struct {
	// Auth mocks
	StartDeviceLoginFn           func(ctx context.Context, repository string, repoIds *RepoIds) (*DeviceStartResponse, error)
	PollDeviceLoginFn            func(ctx context.Context, deviceCode string) (*DevicePollResponse, error)
	ValidateTokenFn              func(ctx context.Context) (*ValidateTokenResponse, error)
	CheckGitHubAppInstallationFn func(ctx context.Context, repoOwner, repoName string) (*GitHubAppInstallationStatus, error)
	GetRepoIdsFromBackendFn      func(ctx context.Context, repoFullName string) (*RepoIds, error)

	// Vault mocks
	InitVaultFn            func(ctx context.Context, repoFullName string) (*InitVaultResponse, error)
	CheckVaultExistsFn     func(ctx context.Context, repoFullName string) (bool, error)
	GetVaultDetailsFn      func(ctx context.Context, repoFullName string) (*VaultDetails, error)
	GetVaultEnvironmentsFn func(ctx context.Context, repoFullName string) ([]string, error)

	// Secrets mocks
	PushSecretsFn func(ctx context.Context, repo, env string, secrets map[string]string) (*PushSecretsResponse, error)
	PullSecretsFn func(ctx context.Context, repo, env string) (*PullSecretsResponse, error)

	// Provider mocks
	GetProvidersFn           func(ctx context.Context) ([]Provider, error)
	GetConnectionsFn         func(ctx context.Context) ([]Connection, error)
	DeleteConnectionFn       func(ctx context.Context, connectionID string) error
	GetProviderAuthURLFn     func(provider string) string
	ConnectWithTokenFn       func(ctx context.Context, provider, providerToken string) (*ConnectTokenResponse, error)
	GetAllProviderProjectsFn func(ctx context.Context, provider string) ([]ProviderProject, []Connection, error)

	// Sync mocks
	GetSyncStatusFn  func(ctx context.Context, repo, connectionID, projectID, environment string) (*SyncStatus, error)
	GetSyncDiffFn    func(ctx context.Context, repo string, opts SyncOptions) (*SyncDiff, error)
	GetSyncPreviewFn func(ctx context.Context, repo string, opts SyncOptions) (*SyncPreview, error)
	ExecuteSyncFn    func(ctx context.Context, repo string, opts SyncOptions) (*SyncResult, error)

	// Call tracking
	Calls map[string]int
}

// NewMockClient creates a new mock client with default implementations
func NewMockClient() *MockClient {
	return &MockClient{
		Calls: make(map[string]int),
	}
}

func (m *MockClient) track(method string) {
	if m.Calls == nil {
		m.Calls = make(map[string]int)
	}
	m.Calls[method]++
}

// Auth methods
func (m *MockClient) StartDeviceLogin(ctx context.Context, repository string, repoIds *RepoIds) (*DeviceStartResponse, error) {
	m.track("StartDeviceLogin")
	if m.StartDeviceLoginFn != nil {
		return m.StartDeviceLoginFn(ctx, repository, repoIds)
	}
	return &DeviceStartResponse{
		DeviceCode:              "test-device-code",
		UserCode:                "TEST-CODE",
		VerificationURIComplete: "https://github.com/login/device",
		VerificationURI:         "https://github.com/login/device",
		ExpiresIn:               900,
		Interval:                5,
	}, nil
}

func (m *MockClient) GetRepoIdsFromBackend(ctx context.Context, repoFullName string) (*RepoIds, error) {
	m.track("GetRepoIdsFromBackend")
	if m.GetRepoIdsFromBackendFn != nil {
		return m.GetRepoIdsFromBackendFn(ctx, repoFullName)
	}
	return nil, nil
}

func (m *MockClient) PollDeviceLogin(ctx context.Context, deviceCode string) (*DevicePollResponse, error) {
	m.track("PollDeviceLogin")
	if m.PollDeviceLoginFn != nil {
		return m.PollDeviceLoginFn(ctx, deviceCode)
	}
	return &DevicePollResponse{
		Status:      "approved",
		KeywayToken: "test-keyway-token",
		GitHubLogin: "testuser",
	}, nil
}

func (m *MockClient) ValidateToken(ctx context.Context) (*ValidateTokenResponse, error) {
	m.track("ValidateToken")
	if m.ValidateTokenFn != nil {
		return m.ValidateTokenFn(ctx)
	}
	return &ValidateTokenResponse{
		Login:    "testuser",
		Username: "testuser",
	}, nil
}

func (m *MockClient) CheckGitHubAppInstallation(ctx context.Context, repoOwner, repoName string) (*GitHubAppInstallationStatus, error) {
	m.track("CheckGitHubAppInstallation")
	if m.CheckGitHubAppInstallationFn != nil {
		return m.CheckGitHubAppInstallationFn(ctx, repoOwner, repoName)
	}
	return &GitHubAppInstallationStatus{
		Installed:      true,
		InstallationID: 12345,
	}, nil
}

// Vault methods
func (m *MockClient) InitVault(ctx context.Context, repoFullName string) (*InitVaultResponse, error) {
	m.track("InitVault")
	if m.InitVaultFn != nil {
		return m.InitVaultFn(ctx, repoFullName)
	}
	return &InitVaultResponse{
		VaultID:      "vault-123",
		RepoFullName: repoFullName,
		Message:      "Vault created successfully",
	}, nil
}

func (m *MockClient) CheckVaultExists(ctx context.Context, repoFullName string) (bool, error) {
	m.track("CheckVaultExists")
	if m.CheckVaultExistsFn != nil {
		return m.CheckVaultExistsFn(ctx, repoFullName)
	}
	return true, nil
}

func (m *MockClient) GetVaultDetails(ctx context.Context, repoFullName string) (*VaultDetails, error) {
	m.track("GetVaultDetails")
	if m.GetVaultDetailsFn != nil {
		return m.GetVaultDetailsFn(ctx, repoFullName)
	}
	return &VaultDetails{
		ID:           "vault-123",
		RepoFullName: repoFullName,
		SecretCount:  5,
	}, nil
}

func (m *MockClient) GetVaultEnvironments(ctx context.Context, repoFullName string) ([]string, error) {
	m.track("GetVaultEnvironments")
	if m.GetVaultEnvironmentsFn != nil {
		return m.GetVaultEnvironmentsFn(ctx, repoFullName)
	}
	return []string{"production", "staging", "development"}, nil
}

// Secrets methods
func (m *MockClient) PushSecrets(ctx context.Context, repo, env string, secrets map[string]string) (*PushSecretsResponse, error) {
	m.track("PushSecrets")
	if m.PushSecretsFn != nil {
		return m.PushSecretsFn(ctx, repo, env, secrets)
	}
	return &PushSecretsResponse{
		Success: true,
		Message: fmt.Sprintf("Pushed %d secrets to %s/%s", len(secrets), repo, env),
		Stats: &struct {
			Created int `json:"created"`
			Updated int `json:"updated"`
			Deleted int `json:"deleted"`
		}{
			Created: len(secrets),
			Updated: 0,
			Deleted: 0,
		},
	}, nil
}

func (m *MockClient) PullSecrets(ctx context.Context, repo, env string) (*PullSecretsResponse, error) {
	m.track("PullSecrets")
	if m.PullSecretsFn != nil {
		return m.PullSecretsFn(ctx, repo, env)
	}
	return &PullSecretsResponse{
		Content: "API_KEY=test-api-key\nDB_HOST=localhost\nDB_PORT=5432\n",
	}, nil
}

// Provider methods
func (m *MockClient) GetProviders(ctx context.Context) ([]Provider, error) {
	m.track("GetProviders")
	if m.GetProvidersFn != nil {
		return m.GetProvidersFn(ctx)
	}
	return []Provider{
		{Name: "vercel", DisplayName: "Vercel", Configured: true},
		{Name: "railway", DisplayName: "Railway", Configured: true},
	}, nil
}

func (m *MockClient) GetConnections(ctx context.Context) ([]Connection, error) {
	m.track("GetConnections")
	if m.GetConnectionsFn != nil {
		return m.GetConnectionsFn(ctx)
	}
	return []Connection{
		{ID: "conn-1", Provider: "vercel", CreatedAt: "2024-01-01T00:00:00Z"},
	}, nil
}

func (m *MockClient) DeleteConnection(ctx context.Context, connectionID string) error {
	m.track("DeleteConnection")
	if m.DeleteConnectionFn != nil {
		return m.DeleteConnectionFn(ctx, connectionID)
	}
	return nil
}

func (m *MockClient) GetProviderAuthURL(provider string) string {
	m.track("GetProviderAuthURL")
	if m.GetProviderAuthURLFn != nil {
		return m.GetProviderAuthURLFn(provider)
	}
	return fmt.Sprintf("https://api.keyway.sh/v1/auth/%s", provider)
}

func (m *MockClient) ConnectWithToken(ctx context.Context, provider, providerToken string) (*ConnectTokenResponse, error) {
	m.track("ConnectWithToken")
	if m.ConnectWithTokenFn != nil {
		return m.ConnectWithTokenFn(ctx, provider, providerToken)
	}
	return &ConnectTokenResponse{
		Success: true,
		User: struct {
			Username string  `json:"username"`
			TeamName *string `json:"teamName,omitempty"`
		}{
			Username: "testuser",
		},
	}, nil
}

func (m *MockClient) GetAllProviderProjects(ctx context.Context, provider string) ([]ProviderProject, []Connection, error) {
	m.track("GetAllProviderProjects")
	if m.GetAllProviderProjectsFn != nil {
		return m.GetAllProviderProjectsFn(ctx, provider)
	}
	return []ProviderProject{
			{ID: "proj-1", Name: "my-project", ConnectionID: "conn-1"},
		}, []Connection{
			{ID: "conn-1", Provider: provider},
		}, nil
}

// Sync methods
func (m *MockClient) GetSyncStatus(ctx context.Context, repo, connectionID, projectID, environment string) (*SyncStatus, error) {
	m.track("GetSyncStatus")
	if m.GetSyncStatusFn != nil {
		return m.GetSyncStatusFn(ctx, repo, connectionID, projectID, environment)
	}
	return &SyncStatus{
		IsFirstSync:         false,
		VaultIsEmpty:        false,
		ProviderHasSecrets:  true,
		ProviderSecretCount: 5,
	}, nil
}

func (m *MockClient) GetSyncDiff(ctx context.Context, repo string, opts SyncOptions) (*SyncDiff, error) {
	m.track("GetSyncDiff")
	if m.GetSyncDiffFn != nil {
		return m.GetSyncDiffFn(ctx, repo, opts)
	}
	return &SyncDiff{
		KeywayCount:    3,
		ProviderCount:  2,
		OnlyInKeyway:   []string{"SECRET_A"},
		OnlyInProvider: []string{},
		Different:      []string{"SECRET_B"},
		Same:           []string{"SECRET_C"},
	}, nil
}

func (m *MockClient) GetSyncPreview(ctx context.Context, repo string, opts SyncOptions) (*SyncPreview, error) {
	m.track("GetSyncPreview")
	if m.GetSyncPreviewFn != nil {
		return m.GetSyncPreviewFn(ctx, repo, opts)
	}
	return &SyncPreview{
		ToCreate: []string{"SECRET_A"},
		ToUpdate: []string{"SECRET_B"},
		ToDelete: []string{},
		ToSkip:   []string{"SECRET_C"},
	}, nil
}

func (m *MockClient) ExecuteSync(ctx context.Context, repo string, opts SyncOptions) (*SyncResult, error) {
	m.track("ExecuteSync")
	if m.ExecuteSyncFn != nil {
		return m.ExecuteSyncFn(ctx, repo, opts)
	}
	return &SyncResult{
		Success: true,
		Stats: struct {
			Created int `json:"created"`
			Updated int `json:"updated"`
			Deleted int `json:"deleted"`
		}{
			Created: 1,
			Updated: 1,
			Deleted: 0,
		},
	}, nil
}

func (m *MockClient) StartOrganizationTrial(ctx context.Context, orgLogin string) (*StartTrialResponse, error) {
	return &StartTrialResponse{
		Message:   "Trial started",
		TrialEnds: "2025-02-01",
	}, nil
}

// Verify MockClient implements APIClient
var _ APIClient = (*MockClient)(nil)
