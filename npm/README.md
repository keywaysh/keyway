# @keywaysh/cli

GitHub-native secrets management CLI.

## Installation

```bash
npm install -g @keywaysh/cli
```

## Alternative installation methods

### Homebrew (macOS/Linux)

```bash
brew install keywaysh/tap/keyway
```

### curl (macOS/Linux)

```bash
curl -fsSL https://get.keyway.sh | sh
```

### Manual download

Download the latest release from [GitHub Releases](https://github.com/keywaysh/cli/releases).

## Usage

```bash
# Authenticate with GitHub
keyway login

# Initialize a vault for your repository
keyway init

# Push secrets to the vault
keyway push

# Pull secrets from the vault
keyway pull

# Run diagnostics
keyway doctor
```

## Documentation

Full documentation at [docs.keyway.sh](https://docs.keyway.sh)

## License

MIT
