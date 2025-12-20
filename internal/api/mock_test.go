package api

import (
	"context"
	"errors"
	"testing"
)

func TestMockClient_DefaultBehavior(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Test StartDeviceLogin
	resp, err := mock.StartDeviceLogin(ctx, "owner/repo")
	if err != nil {
		t.Errorf("StartDeviceLogin() error = %v", err)
	}
	if resp.DeviceCode == "" {
		t.Error("StartDeviceLogin() should return a device code")
	}
	if mock.Calls["StartDeviceLogin"] != 1 {
		t.Errorf("StartDeviceLogin call count = %d, want 1", mock.Calls["StartDeviceLogin"])
	}

	// Test PollDeviceLogin
	pollResp, err := mock.PollDeviceLogin(ctx, "test-code")
	if err != nil {
		t.Errorf("PollDeviceLogin() error = %v", err)
	}
	if pollResp.Status != "approved" {
		t.Errorf("PollDeviceLogin() status = %v, want approved", pollResp.Status)
	}

	// Test ValidateToken
	validateResp, err := mock.ValidateToken(ctx)
	if err != nil {
		t.Errorf("ValidateToken() error = %v", err)
	}
	if validateResp.Username == "" {
		t.Error("ValidateToken() should return a username")
	}

	// Test CheckGitHubAppInstallation
	installResp, err := mock.CheckGitHubAppInstallation(ctx, "owner", "repo")
	if err != nil {
		t.Errorf("CheckGitHubAppInstallation() error = %v", err)
	}
	if !installResp.Installed {
		t.Error("CheckGitHubAppInstallation() should return installed=true by default")
	}
}

func TestMockClient_VaultMethods(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Test InitVault
	initResp, err := mock.InitVault(ctx, "owner/repo")
	if err != nil {
		t.Errorf("InitVault() error = %v", err)
	}
	if initResp.VaultID == "" {
		t.Error("InitVault() should return a vault ID")
	}

	// Test CheckVaultExists
	exists, err := mock.CheckVaultExists(ctx, "owner/repo")
	if err != nil {
		t.Errorf("CheckVaultExists() error = %v", err)
	}
	if !exists {
		t.Error("CheckVaultExists() should return true by default")
	}

	// Test GetVaultEnvironments
	envs, err := mock.GetVaultEnvironments(ctx, "owner/repo")
	if err != nil {
		t.Errorf("GetVaultEnvironments() error = %v", err)
	}
	if len(envs) == 0 {
		t.Error("GetVaultEnvironments() should return environments")
	}
}

func TestMockClient_SecretsMethods(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Test PushSecrets
	secrets := map[string]string{"API_KEY": "secret123"}
	pushResp, err := mock.PushSecrets(ctx, "owner/repo", "production", secrets)
	if err != nil {
		t.Errorf("PushSecrets() error = %v", err)
	}
	if !pushResp.Success {
		t.Error("PushSecrets() should succeed by default")
	}
	if pushResp.Stats == nil || pushResp.Stats.Created != 1 {
		t.Error("PushSecrets() should report 1 created")
	}

	// Test PullSecrets
	pullResp, err := mock.PullSecrets(ctx, "owner/repo", "production")
	if err != nil {
		t.Errorf("PullSecrets() error = %v", err)
	}
	if pullResp.Content == "" {
		t.Error("PullSecrets() should return content")
	}
}

func TestMockClient_ProviderMethods(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Test GetProviders
	providers, err := mock.GetProviders(ctx)
	if err != nil {
		t.Errorf("GetProviders() error = %v", err)
	}
	if len(providers) == 0 {
		t.Error("GetProviders() should return providers")
	}

	// Test GetConnections
	connections, err := mock.GetConnections(ctx)
	if err != nil {
		t.Errorf("GetConnections() error = %v", err)
	}
	if len(connections) == 0 {
		t.Error("GetConnections() should return connections")
	}

	// Test DeleteConnection
	err = mock.DeleteConnection(ctx, "conn-1")
	if err != nil {
		t.Errorf("DeleteConnection() error = %v", err)
	}

	// Test GetProviderAuthURL
	url := mock.GetProviderAuthURL("vercel")
	if url == "" {
		t.Error("GetProviderAuthURL() should return a URL")
	}

	// Test ConnectWithToken
	connectResp, err := mock.ConnectWithToken(ctx, "railway", "test-token")
	if err != nil {
		t.Errorf("ConnectWithToken() error = %v", err)
	}
	if !connectResp.Success {
		t.Error("ConnectWithToken() should succeed by default")
	}

	// Test GetAllProviderProjects
	projects, conns, err := mock.GetAllProviderProjects(ctx, "vercel")
	if err != nil {
		t.Errorf("GetAllProviderProjects() error = %v", err)
	}
	if len(projects) == 0 {
		t.Error("GetAllProviderProjects() should return projects")
	}
	if len(conns) == 0 {
		t.Error("GetAllProviderProjects() should return connections")
	}
}

func TestMockClient_SyncMethods(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Test GetSyncStatus
	status, err := mock.GetSyncStatus(ctx, "owner/repo", "conn-1", "proj-1", "production")
	if err != nil {
		t.Errorf("GetSyncStatus() error = %v", err)
	}
	if status == nil {
		t.Error("GetSyncStatus() should return status")
	}

	opts := SyncOptions{
		ConnectionID:        "conn-1",
		ProjectID:           "proj-1",
		KeywayEnvironment:   "production",
		ProviderEnvironment: "production",
		Direction:           "push",
	}

	// Test GetSyncDiff
	diff, err := mock.GetSyncDiff(ctx, "owner/repo", opts)
	if err != nil {
		t.Errorf("GetSyncDiff() error = %v", err)
	}
	if diff == nil {
		t.Error("GetSyncDiff() should return diff")
	}

	// Test GetSyncPreview
	preview, err := mock.GetSyncPreview(ctx, "owner/repo", opts)
	if err != nil {
		t.Errorf("GetSyncPreview() error = %v", err)
	}
	if preview == nil {
		t.Error("GetSyncPreview() should return preview")
	}

	// Test ExecuteSync
	result, err := mock.ExecuteSync(ctx, "owner/repo", opts)
	if err != nil {
		t.Errorf("ExecuteSync() error = %v", err)
	}
	if !result.Success {
		t.Error("ExecuteSync() should succeed by default")
	}
}

func TestMockClient_CustomBehavior(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Custom error response
	expectedErr := errors.New("auth failed")
	mock.ValidateTokenFn = func(ctx context.Context) (*ValidateTokenResponse, error) {
		return nil, expectedErr
	}

	_, err := mock.ValidateToken(ctx)
	if err != expectedErr {
		t.Errorf("ValidateToken() error = %v, want %v", err, expectedErr)
	}

	// Custom success response
	mock.CheckVaultExistsFn = func(ctx context.Context, repoFullName string) (bool, error) {
		return false, nil
	}

	exists, err := mock.CheckVaultExists(ctx, "owner/repo")
	if err != nil {
		t.Errorf("CheckVaultExists() error = %v", err)
	}
	if exists {
		t.Error("CheckVaultExists() should return false with custom function")
	}
}

func TestMockClient_CallTracking(t *testing.T) {
	mock := NewMockClient()
	ctx := context.Background()

	// Make multiple calls
	mock.ValidateToken(ctx)
	mock.ValidateToken(ctx)
	mock.ValidateToken(ctx)
	mock.InitVault(ctx, "owner/repo")

	if mock.Calls["ValidateToken"] != 3 {
		t.Errorf("ValidateToken call count = %d, want 3", mock.Calls["ValidateToken"])
	}
	if mock.Calls["InitVault"] != 1 {
		t.Errorf("InitVault call count = %d, want 1", mock.Calls["InitVault"])
	}
	if mock.Calls["PushSecrets"] != 0 {
		t.Errorf("PushSecrets call count = %d, want 0", mock.Calls["PushSecrets"])
	}
}

func TestMockClient_NilCallsMap(t *testing.T) {
	// Test that track() initializes the map if nil
	mock := &MockClient{}
	ctx := context.Background()

	// This should not panic even without initializing Calls
	mock.ValidateToken(ctx)

	if mock.Calls == nil {
		t.Error("Calls map should be initialized")
	}
	if mock.Calls["ValidateToken"] != 1 {
		t.Errorf("ValidateToken call count = %d, want 1", mock.Calls["ValidateToken"])
	}
}
