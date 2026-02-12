package cmd

import (
	"context"
	"errors"

	"github.com/keywaysh/cli/internal/api"
)

// MockGitClient is a mock implementation of GitClient
type MockGitClient struct {
	Repo             string
	RepoError        error
	EnvInGitignore   bool
	AddGitignoreErr  error
	IsGitRepo        bool
	Monorepo         MonorepoInfo
}

func (m *MockGitClient) DetectRepo() (string, error) {
	return m.Repo, m.RepoError
}

func (m *MockGitClient) CheckEnvGitignore() bool {
	return m.EnvInGitignore
}

func (m *MockGitClient) AddEnvToGitignore() error {
	return m.AddGitignoreErr
}

func (m *MockGitClient) IsGitRepository() bool {
	return m.IsGitRepo
}

func (m *MockGitClient) DetectMonorepo() MonorepoInfo {
	return m.Monorepo
}

// MockAuthProvider is a mock implementation of AuthProvider
type MockAuthProvider struct {
	Token string
	Error error
}

func (m *MockAuthProvider) EnsureLogin() (string, error) {
	return m.Token, m.Error
}

// MockUIProvider is a mock implementation of UIProvider
type MockUIProvider struct {
	Interactive     bool
	ConfirmResult   bool
	ConfirmError    error
	SelectResult    string
	SelectError     error
	PasswordResult  string
	PasswordError   error
	SpinError       error

	// Track calls for assertions
	IntroCalls       []string
	OutroCalls       []string
	SuccessCalls     []string
	ErrorCalls       []string
	WarnCalls        []string
	InfoCalls        []string
	StepCalls        []string
	MessageCalls     []string
	ConfirmCalls     []string
	SelectCalls      []string
	PasswordCalls    []string
	DiffAddedCalls   []string
	DiffChangedCalls []string
	DiffRemovedCalls []string
	DiffKeptCalls    []string
}

func (m *MockUIProvider) Intro(command string)    { m.IntroCalls = append(m.IntroCalls, command) }
func (m *MockUIProvider) Outro(message string)    { m.OutroCalls = append(m.OutroCalls, message) }
func (m *MockUIProvider) Success(message string)  { m.SuccessCalls = append(m.SuccessCalls, message) }
func (m *MockUIProvider) Error(message string)    { m.ErrorCalls = append(m.ErrorCalls, message) }
func (m *MockUIProvider) Warn(message string)     { m.WarnCalls = append(m.WarnCalls, message) }
func (m *MockUIProvider) Info(message string)     { m.InfoCalls = append(m.InfoCalls, message) }
func (m *MockUIProvider) Step(message string)     { m.StepCalls = append(m.StepCalls, message) }
func (m *MockUIProvider) Message(message string)  { m.MessageCalls = append(m.MessageCalls, message) }
func (m *MockUIProvider) IsInteractive() bool     { return m.Interactive }
func (m *MockUIProvider) Confirm(message string, defaultValue bool) (bool, error) {
	m.ConfirmCalls = append(m.ConfirmCalls, message)
	return m.ConfirmResult, m.ConfirmError
}
func (m *MockUIProvider) Select(message string, options []string) (string, error) {
	m.SelectCalls = append(m.SelectCalls, message)
	return m.SelectResult, m.SelectError
}
func (m *MockUIProvider) Password(prompt string) (string, error) {
	m.PasswordCalls = append(m.PasswordCalls, prompt)
	return m.PasswordResult, m.PasswordError
}
func (m *MockUIProvider) Spin(message string, fn func() error) error {
	if m.SpinError != nil {
		return m.SpinError
	}
	return fn()
}
func (m *MockUIProvider) Value(v interface{}) string   { return "" }
func (m *MockUIProvider) File(path string) string      { return path }
func (m *MockUIProvider) Link(url string) string       { return url }
func (m *MockUIProvider) Command(cmd string) string    { return cmd }
func (m *MockUIProvider) Bold(text string) string      { return text }
func (m *MockUIProvider) Dim(text string) string       { return text }
func (m *MockUIProvider) DiffAdded(key string)   { m.DiffAddedCalls = append(m.DiffAddedCalls, key) }
func (m *MockUIProvider) DiffChanged(key string) { m.DiffChangedCalls = append(m.DiffChangedCalls, key) }
func (m *MockUIProvider) DiffRemoved(key string) { m.DiffRemovedCalls = append(m.DiffRemovedCalls, key) }
func (m *MockUIProvider) DiffKept(key string)    { m.DiffKeptCalls = append(m.DiffKeptCalls, key) }

// MockFileSystem is a mock implementation of FileSystem
type MockFileSystem struct {
	Files      map[string][]byte
	WriteError error
	ReadError  error
	Written    map[string][]byte
}

func NewMockFileSystem() *MockFileSystem {
	return &MockFileSystem{
		Files:   make(map[string][]byte),
		Written: make(map[string][]byte),
	}
}

func (m *MockFileSystem) ReadFile(name string) ([]byte, error) {
	if m.ReadError != nil {
		return nil, m.ReadError
	}
	if data, ok := m.Files[name]; ok {
		return data, nil
	}
	return nil, errors.New("file not found")
}

func (m *MockFileSystem) WriteFile(name string, data []byte, perm uint32) error {
	if m.WriteError != nil {
		return m.WriteError
	}
	m.Written[name] = data
	return nil
}

// MockAPIClient is a mock implementation of api.APIClient
type MockAPIClient struct {
	VaultEnvs                          []string
	VaultEnvsError                     error
	PullResponse                       *api.PullSecretsResponse
	PullError                          error
	PushResponse                       *api.PushSecretsResponse
	PushError                          error
	PushedSecrets                      map[string]string // Captures secrets sent in PushSecrets call
	InitResponse                       *api.InitVaultResponse
	InitError                          error
	VaultExists                        bool
	VaultExistsError                   error
	VaultDetails                       *api.VaultDetails
	VaultDetailsError                  error
	ValidateTokenResponse              *api.ValidateTokenResponse
	ValidateTokenError                 error
	CheckGitHubAppInstallationResponse *api.GitHubAppInstallationStatus
	CheckGitHubAppInstallationError    error
}

func (m *MockAPIClient) StartDeviceLogin(ctx context.Context, repository string, repoIds *api.RepoIds) (*api.DeviceStartResponse, error) {
	return nil, nil
}
func (m *MockAPIClient) PollDeviceLogin(ctx context.Context, deviceCode string) (*api.DevicePollResponse, error) {
	return nil, nil
}
func (m *MockAPIClient) ValidateToken(ctx context.Context) (*api.ValidateTokenResponse, error) {
	return m.ValidateTokenResponse, m.ValidateTokenError
}
func (m *MockAPIClient) CheckGitHubAppInstallation(ctx context.Context, repoOwner, repoName string) (*api.GitHubAppInstallationStatus, error) {
	return m.CheckGitHubAppInstallationResponse, m.CheckGitHubAppInstallationError
}
func (m *MockAPIClient) GetRepoIdsFromBackend(ctx context.Context, repoFullName string) (*api.RepoIds, error) {
	return nil, nil
}
func (m *MockAPIClient) InitVault(ctx context.Context, repoFullName string) (*api.InitVaultResponse, error) {
	return m.InitResponse, m.InitError
}
func (m *MockAPIClient) CheckVaultExists(ctx context.Context, repoFullName string) (bool, error) {
	return m.VaultExists, m.VaultExistsError
}
func (m *MockAPIClient) GetVaultDetails(ctx context.Context, repoFullName string) (*api.VaultDetails, error) {
	return m.VaultDetails, m.VaultDetailsError
}
func (m *MockAPIClient) GetVaultEnvironments(ctx context.Context, repoFullName string) ([]string, error) {
	return m.VaultEnvs, m.VaultEnvsError
}
func (m *MockAPIClient) PushSecrets(ctx context.Context, repo, env string, secrets map[string]string) (*api.PushSecretsResponse, error) {
	m.PushedSecrets = secrets
	return m.PushResponse, m.PushError
}
func (m *MockAPIClient) PullSecrets(ctx context.Context, repo, env string) (*api.PullSecretsResponse, error) {
	return m.PullResponse, m.PullError
}
func (m *MockAPIClient) GetProviders(ctx context.Context) ([]api.Provider, error) {
	return nil, nil
}
func (m *MockAPIClient) GetConnections(ctx context.Context) ([]api.Connection, error) {
	return nil, nil
}
func (m *MockAPIClient) DeleteConnection(ctx context.Context, connectionID string) error {
	return nil
}
func (m *MockAPIClient) GetProviderAuthURL(provider string) string {
	return ""
}
func (m *MockAPIClient) ConnectWithToken(ctx context.Context, provider, providerToken string) (*api.ConnectTokenResponse, error) {
	return nil, nil
}
func (m *MockAPIClient) GetAllProviderProjects(ctx context.Context, provider string) ([]api.ProviderProject, []api.Connection, error) {
	return nil, nil, nil
}
func (m *MockAPIClient) GetSyncStatus(ctx context.Context, repo, connectionID, projectID, environment string) (*api.SyncStatus, error) {
	return nil, nil
}
func (m *MockAPIClient) GetSyncDiff(ctx context.Context, repo string, opts api.SyncOptions) (*api.SyncDiff, error) {
	return nil, nil
}
func (m *MockAPIClient) GetSyncPreview(ctx context.Context, repo string, opts api.SyncOptions) (*api.SyncPreview, error) {
	return nil, nil
}
func (m *MockAPIClient) ExecuteSync(ctx context.Context, repo string, opts api.SyncOptions) (*api.SyncResult, error) {
	return nil, nil
}
func (m *MockAPIClient) StartOrganizationTrial(ctx context.Context, orgLogin string) (*api.StartTrialResponse, error) {
	return nil, nil
}

// MockAPIFactory creates mock API clients
type MockAPIFactory struct {
	Client api.APIClient
}

func (m *MockAPIFactory) NewClient(token string) api.APIClient {
	return m.Client
}

// MockEnvHelper is a mock implementation of EnvHelper
type MockEnvHelper struct {
	Candidates      []EnvCandidate
	DerivedEnvName  string
}

func (m *MockEnvHelper) Discover() []EnvCandidate {
	return m.Candidates
}

func (m *MockEnvHelper) DeriveEnvFromFile(file string) string {
	if m.DerivedEnvName != "" {
		return m.DerivedEnvName
	}
	return "development"
}

// MockCommandRunner is a mock implementation of CommandRunner
type MockCommandRunner struct {
	RunError      error
	LastCommand   string
	LastArgs      []string
	LastSecrets   map[string]string
}

func (m *MockCommandRunner) RunCommand(name string, args []string, secrets map[string]string) error {
	m.LastCommand = name
	m.LastArgs = args
	m.LastSecrets = secrets
	return m.RunError
}

// MockBrowserOpener is a mock implementation of BrowserOpener
type MockBrowserOpener struct {
	OpenError error
	LastURL   string
}

func (m *MockBrowserOpener) OpenURL(url string) error {
	m.LastURL = url
	return m.OpenError
}

// MockAuthStore is a mock implementation of AuthStore
type MockAuthStore struct {
	StoredAuth *StoredAuthInfo
	AuthError  error
}

func (m *MockAuthStore) GetAuth() (*StoredAuthInfo, error) {
	return m.StoredAuth, m.AuthError
}

// MockHTTPClient is a mock implementation of HTTPClient
type MockHTTPClient struct {
	StatusCode int
	HeadError  error
}

func (m *MockHTTPClient) Head(url string) (int, error) {
	return m.StatusCode, m.HeadError
}

// MockFileInfo is a mock implementation of FileInfo
type MockFileInfo struct {
	FileName  string
	FileIsDir bool
	FileSize  int64
}

func (m *MockFileInfo) Name() string { return m.FileName }
func (m *MockFileInfo) IsDir() bool  { return m.FileIsDir }
func (m *MockFileInfo) Size() int64  { return m.FileSize }

// MockFileWalker is a mock implementation of FileWalker
type MockFileWalker struct {
	Files     []MockWalkFile
	WalkError error
}

type MockWalkFile struct {
	Path  string
	Info  *MockFileInfo
	Error error
}

func (m *MockFileWalker) Walk(root string, fn func(path string, info FileInfo, err error) error) error {
	if m.WalkError != nil {
		return m.WalkError
	}
	for _, f := range m.Files {
		if err := fn(f.Path, f.Info, f.Error); err != nil {
			return err
		}
	}
	return nil
}

// MockFileStat is a mock implementation of FileStat
type MockFileStat struct {
	Files     map[string]*MockFileInfo
	StatError error
}

func NewMockFileStat() *MockFileStat {
	return &MockFileStat{
		Files: make(map[string]*MockFileInfo),
	}
}

func (m *MockFileStat) Stat(name string) (FileInfo, error) {
	if m.StatError != nil {
		return nil, m.StatError
	}
	if info, ok := m.Files[name]; ok {
		return info, nil
	}
	return nil, errors.New("file not found")
}

// NewTestDeps creates a Dependencies with all mocks for testing
func NewTestDeps() (*Dependencies, *MockGitClient, *MockAuthProvider, *MockUIProvider, *MockFileSystem, *MockAPIClient) {
	git := &MockGitClient{
		Repo:           "owner/repo",
		EnvInGitignore: true,
		IsGitRepo:      true,
	}
	auth := &MockAuthProvider{Token: "test-token"}
	ui := &MockUIProvider{Interactive: false}
	fs := NewMockFileSystem()
	envHelper := &MockEnvHelper{}
	apiClient := &MockAPIClient{}
	apiFactory := &MockAPIFactory{Client: apiClient}
	cmdRunner := &MockCommandRunner{}
	browser := &MockBrowserOpener{}
	walker := &MockFileWalker{}
	stat := NewMockFileStat()
	authStore := &MockAuthStore{}
	httpClient := &MockHTTPClient{StatusCode: 200}

	deps := &Dependencies{
		Git:        git,
		Auth:       auth,
		UI:         ui,
		FS:         fs,
		Env:        envHelper,
		APIFactory: apiFactory,
		CmdRunner:  cmdRunner,
		Browser:    browser,
		Walker:     walker,
		Stat:       stat,
		AuthStore:  authStore,
		HTTP:       httpClient,
	}

	return deps, git, auth, ui, fs, apiClient
}

// NewTestDepsWithEnv creates a Dependencies with all mocks including EnvHelper
func NewTestDepsWithEnv() (*Dependencies, *MockGitClient, *MockAuthProvider, *MockUIProvider, *MockFileSystem, *MockEnvHelper, *MockAPIClient) {
	git := &MockGitClient{
		Repo:           "owner/repo",
		EnvInGitignore: true,
		IsGitRepo:      true,
	}
	auth := &MockAuthProvider{Token: "test-token"}
	ui := &MockUIProvider{Interactive: false}
	fs := NewMockFileSystem()
	envHelper := &MockEnvHelper{}
	apiClient := &MockAPIClient{}
	apiFactory := &MockAPIFactory{Client: apiClient}
	cmdRunner := &MockCommandRunner{}
	browser := &MockBrowserOpener{}
	walker := &MockFileWalker{}
	stat := NewMockFileStat()
	authStore := &MockAuthStore{}
	httpClient := &MockHTTPClient{StatusCode: 200}

	deps := &Dependencies{
		Git:        git,
		Auth:       auth,
		UI:         ui,
		FS:         fs,
		Env:        envHelper,
		APIFactory: apiFactory,
		CmdRunner:  cmdRunner,
		Browser:    browser,
		Walker:     walker,
		Stat:       stat,
		AuthStore:  authStore,
		HTTP:       httpClient,
	}

	return deps, git, auth, ui, fs, envHelper, apiClient
}

// NewTestDepsWithRunner creates a Dependencies with all mocks including CommandRunner
func NewTestDepsWithRunner() (*Dependencies, *MockGitClient, *MockAuthProvider, *MockUIProvider, *MockCommandRunner, *MockAPIClient) {
	git := &MockGitClient{
		Repo:           "owner/repo",
		EnvInGitignore: true,
		IsGitRepo:      true,
	}
	auth := &MockAuthProvider{Token: "test-token"}
	ui := &MockUIProvider{Interactive: false}
	fs := NewMockFileSystem()
	envHelper := &MockEnvHelper{}
	apiClient := &MockAPIClient{}
	apiFactory := &MockAPIFactory{Client: apiClient}
	cmdRunner := &MockCommandRunner{}
	browser := &MockBrowserOpener{}
	walker := &MockFileWalker{}
	stat := NewMockFileStat()
	authStore := &MockAuthStore{}
	httpClient := &MockHTTPClient{StatusCode: 200}

	deps := &Dependencies{
		Git:        git,
		Auth:       auth,
		UI:         ui,
		FS:         fs,
		Env:        envHelper,
		APIFactory: apiFactory,
		CmdRunner:  cmdRunner,
		Browser:    browser,
		Walker:     walker,
		Stat:       stat,
		AuthStore:  authStore,
		HTTP:       httpClient,
	}

	return deps, git, auth, ui, cmdRunner, apiClient
}

// NewTestDepsForDoctor creates a Dependencies with all mocks needed for doctor command
func NewTestDepsForDoctor() (*Dependencies, *MockGitClient, *MockUIProvider, *MockFileStat, *MockAuthStore, *MockHTTPClient, *MockAPIClient) {
	git := &MockGitClient{
		Repo:           "owner/repo",
		EnvInGitignore: true,
		IsGitRepo:      true,
	}
	auth := &MockAuthProvider{Token: "test-token"}
	ui := &MockUIProvider{Interactive: false}
	fs := NewMockFileSystem()
	envHelper := &MockEnvHelper{}
	apiClient := &MockAPIClient{
		ValidateTokenResponse: &api.ValidateTokenResponse{
			Login:    "testuser",
			Username: "testuser",
		},
	}
	apiFactory := &MockAPIFactory{Client: apiClient}
	cmdRunner := &MockCommandRunner{}
	browser := &MockBrowserOpener{}
	walker := &MockFileWalker{}
	stat := NewMockFileStat()
	authStore := &MockAuthStore{
		StoredAuth: &StoredAuthInfo{
			KeywayToken: "test-token",
			GitHubLogin: "testuser",
		},
	}
	httpClient := &MockHTTPClient{StatusCode: 200}

	deps := &Dependencies{
		Git:        git,
		Auth:       auth,
		UI:         ui,
		FS:         fs,
		Env:        envHelper,
		APIFactory: apiFactory,
		CmdRunner:  cmdRunner,
		Browser:    browser,
		Walker:     walker,
		Stat:       stat,
		AuthStore:  authStore,
		HTTP:       httpClient,
	}

	return deps, git, ui, stat, authStore, httpClient, apiClient
}
