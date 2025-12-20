# Keyway CLI

GitHub-native secrets management. Sync secrets with your team and infra.

## Installation

### npm (Node.js)

```bash
npm install -g @keywaysh/cli
```

### Homebrew (macOS/Linux)

```bash
brew install keywaysh/tap/keyway
```

### curl (macOS/Linux)

```bash
curl -fsSL https://get.keyway.sh | sh
```

### Manual download

Download from [GitHub Releases](https://github.com/keywaysh/cli/releases)

## Commands

```
keyway login      # Authenticate with GitHub
keyway logout     # Clear credentials
keyway init       # Initialize vault for repository
keyway push       # Upload secrets to vault
keyway pull       # Download secrets from vault
keyway doctor     # Run environment checks
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
