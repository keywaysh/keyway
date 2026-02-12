package cmd

// This file contains real implementations of all interfaces defined in deps.go.
// These are thin wrappers that delegate to the actual packages.
//
// Coverage Note: These implementations are intentionally excluded from test coverage
// metrics because they are:
// 1. Pure delegation code with no business logic
// 2. Tested implicitly through integration/e2e tests
// 3. The code they wrap (git, auth, ui, etc.) has its own tests
//
// The testable business logic lives in the *WithDeps functions in each command file.

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/auth"
	"github.com/keywaysh/cli/internal/env"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/injector"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/pkg/browser"
)

// realGitClient wraps the git package
type realGitClient struct{}

func (r *realGitClient) DetectRepo() (string, error) { return git.DetectRepo() }
func (r *realGitClient) CheckEnvGitignore() bool     { return git.CheckEnvGitignore() }
func (r *realGitClient) AddEnvToGitignore() error    { return git.AddEnvToGitignore() }
func (r *realGitClient) IsGitRepository() bool       { return git.IsGitRepository() }
func (r *realGitClient) DetectMonorepo() MonorepoInfo {
	info := git.DetectMonorepo()
	return MonorepoInfo{IsMonorepo: info.IsMonorepo, Tool: info.Tool}
}

// realAuthProvider wraps the auth package
type realAuthProvider struct{}

func (r *realAuthProvider) EnsureLogin() (string, error) { return EnsureLogin() }

// realUIProvider wraps the ui package
type realUIProvider struct{}

func (r *realUIProvider) Intro(command string)                                  { ui.Intro(command) }
func (r *realUIProvider) Outro(message string)                                  { ui.Outro(message) }
func (r *realUIProvider) Success(message string)                                { ui.Success(message) }
func (r *realUIProvider) Error(message string)                                  { ui.Error(message) }
func (r *realUIProvider) Warn(message string)                                   { ui.Warn(message) }
func (r *realUIProvider) Info(message string)                                   { ui.Info(message) }
func (r *realUIProvider) Step(message string)                                   { ui.Step(message) }
func (r *realUIProvider) Message(message string)                                { ui.Message(message) }
func (r *realUIProvider) IsInteractive() bool                                   { return ui.IsInteractive() }
func (r *realUIProvider) Confirm(message string, defaultValue bool) (bool, error) {
	return ui.Confirm(message, defaultValue)
}
func (r *realUIProvider) Select(message string, options []string) (string, error) {
	return ui.Select(message, options)
}
func (r *realUIProvider) Password(prompt string) (string, error) {
	return ui.Password(prompt)
}
func (r *realUIProvider) Spin(message string, fn func() error) error { return ui.Spin(message, fn) }
func (r *realUIProvider) Value(v interface{}) string                 { return ui.Value(v) }
func (r *realUIProvider) File(path string) string                    { return ui.File(path) }
func (r *realUIProvider) Link(url string) string                     { return ui.Link(url) }
func (r *realUIProvider) Command(cmd string) string                  { return ui.Command(cmd) }
func (r *realUIProvider) Bold(text string) string                    { return ui.Bold(text) }
func (r *realUIProvider) Dim(text string) string                     { return ui.Dim(text) }
func (r *realUIProvider) DiffAdded(key string)                       { ui.DiffAdded(key) }
func (r *realUIProvider) DiffChanged(key string)                     { ui.DiffChanged(key) }
func (r *realUIProvider) DiffRemoved(key string)                     { ui.DiffRemoved(key) }
func (r *realUIProvider) DiffKept(key string)                        { ui.DiffKept(key) }

// realFileSystem wraps os file operations
type realFileSystem struct{}

func (r *realFileSystem) ReadFile(name string) ([]byte, error) {
	return osReadFile(name)
}

func (r *realFileSystem) WriteFile(name string, data []byte, perm uint32) error {
	return osWriteFile(name, data, perm)
}

// realAPIFactory creates real API clients
type realAPIFactory struct{}

func (r *realAPIFactory) NewClient(token string) api.APIClient {
	return api.NewClient(token)
}

// realEnvHelper wraps the env package
type realEnvHelper struct{}

func (r *realEnvHelper) Discover() []EnvCandidate {
	candidates := env.Discover()
	result := make([]EnvCandidate, len(candidates))
	for i, c := range candidates {
		result[i] = EnvCandidate{File: c.File, Env: c.Env}
	}
	return result
}

func (r *realEnvHelper) DeriveEnvFromFile(file string) string {
	return env.DeriveEnvFromFile(file)
}

// realCommandRunner wraps the injector package
type realCommandRunner struct{}

func (r *realCommandRunner) RunCommand(name string, args []string, secrets map[string]string) error {
	return injector.RunCommand(name, args, secrets)
}

// realBrowserOpener wraps the browser package
type realBrowserOpener struct{}

func (r *realBrowserOpener) OpenURL(url string) error {
	return browser.OpenURL(url)
}

// realFileWalker wraps filepath.Walk
type realFileWalker struct{}

func (r *realFileWalker) Walk(root string, fn func(path string, info FileInfo, err error) error) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if info == nil {
			return fn(path, nil, err)
		}
		return fn(path, &realFileInfo{info}, err)
	})
}

// realFileInfo wraps os.FileInfo
type realFileInfo struct {
	info os.FileInfo
}

func (r *realFileInfo) Name() string { return r.info.Name() }
func (r *realFileInfo) IsDir() bool  { return r.info.IsDir() }
func (r *realFileInfo) Size() int64  { return r.info.Size() }

// realFileStat wraps os.Stat
type realFileStat struct{}

func (r *realFileStat) Stat(name string) (FileInfo, error) {
	info, err := os.Stat(name)
	if err != nil {
		return nil, err
	}
	return &realFileInfo{info}, nil
}

// realAuthStore wraps the auth package
type realAuthStore struct{}

func (r *realAuthStore) GetAuth() (*StoredAuthInfo, error) {
	store := auth.NewStore()
	storedAuth, err := store.GetAuth()
	if err != nil {
		return nil, err
	}
	if storedAuth == nil {
		return nil, nil
	}
	return &StoredAuthInfo{
		KeywayToken: storedAuth.KeywayToken,
		GitHubLogin: storedAuth.GitHubLogin,
	}, nil
}

// realHTTPClient wraps http.Client
type realHTTPClient struct{}

func (r *realHTTPClient) Head(url string) (int, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Head(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// DefaultDeps returns the default (real) dependencies
func DefaultDeps() *Dependencies {
	return &Dependencies{
		Git:        &realGitClient{},
		Auth:       &realAuthProvider{},
		UI:         &realUIProvider{},
		FS:         &realFileSystem{},
		Env:        &realEnvHelper{},
		APIFactory: &realAPIFactory{},
		CmdRunner:  &realCommandRunner{},
		Browser:    &realBrowserOpener{},
		Walker:     &realFileWalker{},
		Stat:       &realFileStat{},
		AuthStore:  &realAuthStore{},
		HTTP:       &realHTTPClient{},
	}
}

// Global default deps for production use
var defaultDeps = DefaultDeps()
