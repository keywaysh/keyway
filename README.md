# Keyway CLI

[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/cli-go)](https://www.keyway.sh/vaults/keywaysh/cli-go)

GitHub-native secrets management. Sync secrets with your team and infra.

## Quick Start

```bash
npx @keywaysh/cli init
```

No install required. This will authenticate, create a vault, and sync your `.env`.

## Installation (optional)

For faster repeated use, install globally:

### npm

```bash
npm install -g @keywaysh/cli
```

### Homebrew (macOS/Linux)

```bash
brew install keywaysh/tap/keyway
```

### Manual download

Download from [GitHub Releases](https://github.com/keywaysh/cli-go/releases)

## Commands

```
keyway login      # Authenticate with GitHub
keyway logout     # Clear credentials
keyway init       # Initialize vault for repository
keyway push       # Upload secrets to vault
keyway pull       # Download secrets from vault
keyway run        # Run command with secrets injected
keyway diff       # Compare local and remote secrets
keyway sync       # Sync with external providers
keyway scan       # Scan for leaked secrets
keyway doctor     # Run environment checks
```

## Runtime Injection (Zero-Trust)

Instead of writing secrets to a `.env` file on disk, you can inject them directly into your application process. This is more secure as secrets never touch the disk.

```bash
# Run with default environment (development)
keyway run -- npm run dev

# Run with specific environment
keyway run --env production -- python3 script.py

# Run a compiled binary
keyway run -- ./my-app
```

## Environment Variables

- `KEYWAY_API_URL` - Override API URL (default: https://api.keyway.sh)
- `KEYWAY_TOKEN` - Authentication token (for CI)
- `KEYWAY_DISABLE_TELEMETRY=1` - Disable anonymous analytics

## Development

### Prerequisites

- Go 1.22+

### Build

```bash
# Build for current platform
make build

# Build for all platforms
make build-all

# Run directly
make run ARGS="--version"
make run ARGS="pull --env production"
```

### Test

```bash
make test
make test-coverage
```

### Install locally

```bash
make install
```

### Release

Releases are automated via GoReleaser when a tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```
