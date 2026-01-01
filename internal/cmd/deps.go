package cmd

// This file defines interfaces for dependency injection.
// Real implementations are in deps_real.go.
// Mock implementations for testing are in mocks_test.go.

import (
	"github.com/keywaysh/cli/internal/api"
)

// MonorepoInfo contains information about detected monorepo setup
type MonorepoInfo struct {
	IsMonorepo bool
	Tool       string
}

// GitClient abstracts git operations for testing
type GitClient interface {
	DetectRepo() (string, error)
	CheckEnvGitignore() bool
	AddEnvToGitignore() error
	IsGitRepository() bool
	DetectMonorepo() MonorepoInfo
}

// AuthProvider abstracts authentication for testing
type AuthProvider interface {
	EnsureLogin() (string, error)
}

// UIProvider abstracts UI operations for testing
type UIProvider interface {
	Intro(command string)
	Outro(message string)
	Success(message string)
	Error(message string)
	Warn(message string)
	Info(message string)
	Step(message string)
	Message(message string)
	IsInteractive() bool
	Confirm(message string, defaultValue bool) (bool, error)
	Select(message string, options []string) (string, error)
	Spin(message string, fn func() error) error
	Value(v interface{}) string
	File(path string) string
	Link(url string) string
	Command(cmd string) string
	Bold(text string) string
	Dim(text string) string
	DiffAdded(key string)
	DiffChanged(key string)
	DiffRemoved(key string)
	DiffKept(key string)
}

// FileSystem abstracts file operations for testing
type FileSystem interface {
	ReadFile(name string) ([]byte, error)
	WriteFile(name string, data []byte, perm uint32) error
}

// EnvHelper abstracts env file operations for testing
type EnvHelper interface {
	Discover() []EnvCandidate
	DeriveEnvFromFile(file string) string
}

// EnvCandidate represents a discovered env file
type EnvCandidate struct {
	File string
	Env  string
}

// APIClientFactory creates API clients
type APIClientFactory interface {
	NewClient(token string) api.APIClient
}

// CommandRunner abstracts command execution for testing
type CommandRunner interface {
	RunCommand(name string, args []string, secrets map[string]string) error
}

// BrowserOpener abstracts browser operations for testing
type BrowserOpener interface {
	OpenURL(url string) error
}

// AuthStore abstracts auth storage for testing
type AuthStore interface {
	GetAuth() (*StoredAuthInfo, error)
}

// StoredAuthInfo contains stored authentication information
type StoredAuthInfo struct {
	KeywayToken string
	GitHubLogin string
}

// HTTPClient abstracts HTTP operations for testing
type HTTPClient interface {
	Head(url string) (int, error)
}

// FileWalker abstracts directory walking for testing
type FileWalker interface {
	Walk(root string, fn func(path string, info FileInfo, err error) error) error
}

// FileInfo abstracts os.FileInfo for testing
type FileInfo interface {
	Name() string
	IsDir() bool
	Size() int64
}

// FileStat abstracts os.Stat for testing
type FileStat interface {
	Stat(name string) (FileInfo, error)
}

// Dependencies holds all external dependencies for commands
type Dependencies struct {
	Git        GitClient
	Auth       AuthProvider
	UI         UIProvider
	FS         FileSystem
	Env        EnvHelper
	APIFactory APIClientFactory
	CmdRunner  CommandRunner
	Browser    BrowserOpener
	Walker     FileWalker
	Stat       FileStat
	AuthStore  AuthStore
	HTTP       HTTPClient
}
