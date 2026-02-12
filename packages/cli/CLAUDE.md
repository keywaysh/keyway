# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Keyway CLI (Go) is the command-line interface for Keyway, a GitHub-native secrets management platform. Written in Go, distributed as a single binary.

## Development Commands

```bash
make build              # Build for current platform → ./bin/keyway
make build-all          # Build for all platforms → ./bin/
make test               # Run tests
make test-coverage      # Run tests with full coverage report
make test-coverage-logic # Coverage for business logic only (excludes wrappers)
make lint               # Run golangci-lint
make install            # Install to /usr/local/bin
make prepare-npm        # Copy README to npm/ for publishing
```

## Architecture

```
cmd/keyway/         # Entry point (main.go)
internal/
├── cmd/            # Cobra commands with DI pattern
│   ├── root.go         # Root command, registers all subcommands
│   ├── deps.go         # Interface definitions for DI
│   ├── deps_real.go    # Real implementations (thin wrappers)
│   ├── fs.go           # File system helpers
│   ├── mocks_test.go   # Mock implementations for testing
│   ├── auth_error.go   # Auth error handling (401 retry)
│   ├── init.go         # keyway init
│   ├── login.go        # keyway login + logout
│   ├── pull.go         # keyway pull
│   ├── push.go         # keyway push
│   ├── set.go          # keyway set (set single secret)
│   ├── run.go          # keyway run (inject secrets into command)
│   ├── diff.go         # keyway diff (compare local vs vault)
│   ├── doctor.go       # keyway doctor (diagnostics)
│   ├── scan.go         # keyway scan (find leaked secrets)
│   ├── sync.go         # keyway sync (sync with external providers)
│   ├── connect.go      # keyway connect/disconnect/connections
│   └── readme.go       # keyway readme (add badge)
├── api/            # Keyway API client
├── auth/           # Token storage (keyring)
├── config/         # Configuration and environment
├── git/            # Git repository detection
├── env/            # Env file parsing and diffing
├── injector/       # Secret injection into subprocess environment
├── analytics/      # PostHog telemetry
└── ui/             # Terminal UI helpers (huh, spinner, colors)
npm/                # npm package for distribution
```

## Key Patterns

### Dependency Injection Pattern

All commands use a DI pattern for testability. Each command has:
1. A thin wrapper `runXXX` that parses flags and calls `runXXXWithDeps`
2. A testable `runXXXWithDeps` that receives a `*Dependencies` struct

```go
// deps.go - Interface definitions
type GitClient interface {
    DetectRepo() (string, error)
    CheckEnvGitignore() bool
    AddEnvToGitignore() error
    IsGitRepository() bool
}

type Dependencies struct {
    Git        GitClient
    Auth       AuthProvider
    UI         UIProvider
    FS         FileSystem
    Env        EnvHelper
    APIFactory APIClientFactory
    // ... more interfaces
}

// command.go - Command implementation
func runPull(cmd *cobra.Command, args []string) error {
    opts := PullOptions{...}
    return runPullWithDeps(opts, defaultDeps)  // defaultDeps has real implementations
}

func runPullWithDeps(opts PullOptions, deps *Dependencies) error {
    // All business logic here, using deps.* for external calls
    repo, err := deps.Git.DetectRepo()
    // ...
}
```

### Testing with Mocks

Tests inject mock implementations via the Dependencies struct:

```go
// mocks_test.go
type MockGitClient struct {
    Repo           string
    RepoError      error
    EnvInGitignore bool
}

func (m *MockGitClient) DetectRepo() (string, error) {
    return m.Repo, m.RepoError
}

// command_test.go
func TestRunPullWithDeps_Success(t *testing.T) {
    deps, gitMock, uiMock, _, _ := NewTestDeps()
    gitMock.Repo = "owner/repo"

    err := runPullWithDeps(PullOptions{EnvName: "dev"}, deps)

    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}
```

### Auth Error Handling

401 errors are handled with automatic re-login prompt:

```go
// In any command that makes API calls:
if isAuthError(err) {
    newToken, authErr := handleAuthError(err, deps)
    if authErr != nil {
        return authErr
    }
    // Retry with new token
    client = deps.APIFactory.NewClient(newToken)
}
```

- Interactive mode: clears token, prompts to re-login via browser
- Non-interactive mode: shows clear instructions to run `keyway logout && keyway login`

### API Client

```go
client := api.NewClient(token)
resp, err := client.PullSecrets(ctx, "owner/repo", "development")
// resp.Content contains the env file content
```

### UI Helpers

```go
deps.UI.Intro("command")      // Command banner
deps.UI.Success("message")    // Green checkmark
deps.UI.Error("message")      // Red X
deps.UI.Spin("Loading...", func() error { ... })
```

## Testing

### Coverage Strategy

- **Business logic** (`runXXXWithDeps` functions): Fully testable via DI, target ~90%+
- **Thin wrappers** (`deps_real.go`): Not unit tested (just delegate to real implementations)
- **Entry points** (`runXXX`, `cmd/keyway/main.go`): Not unit tested

Codecov is configured to ignore non-testable code (see `.codecov.yml`).

### Running Tests

```bash
make test                    # All tests
make test-coverage-logic     # Coverage for business logic only
go test -v ./internal/cmd/... # Verbose output for cmd package
```

## Release Process

1. Tag and push: `git tag v0.3.12 && git push origin v0.3.12`
2. GoReleaser builds binaries for all platforms
3. macOS binaries are signed and notarized
4. Binaries uploaded to GitHub Releases
5. npm package auto-publishes

## npm Distribution

The `npm/` directory contains the npm package (`@keywaysh/cli`) that downloads the Go binary at install time:
- `npm/package.json` - Package config
- `npm/scripts/postinstall.js` - Downloads binary from GitHub Releases
- `npm/bin/keyway` - Shell wrapper that calls the binary
