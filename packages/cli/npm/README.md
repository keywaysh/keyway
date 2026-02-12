# Keyway CLI

**Stop sharing `.env` files on Slack.** GitHub access = secret access.

[![Release](https://img.shields.io/github/v/release/keywaysh/cli?label=release&color=34D399)](https://github.com/keywaysh/cli/releases/latest)
[![CI](https://github.com/keywaysh/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/keywaysh/cli/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/keywaysh/cli/graph/badge.svg?token=O3LRCDFKLS)](https://codecov.io/github/keywaysh/cli)
[![Go Report Card](https://goreportcard.com/badge/github.com/keywaysh/cli)](https://goreportcard.com/report/github.com/keywaysh/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/cli)](https://www.keyway.sh/vaults/keywaysh/cli)

---

## The Problem

You're still doing this:
- Pasting secrets in Slack DMs
- Emailing `.env` files to new devs
- Rotating every secret when someone leaves
- Manually copying vars to Vercel/Railway/Netlify

## The Solution

```bash
keyway pull
```

That's it. If you have access to the repo, you have access to the secrets. No invites, no training, no friction.

---

## Install

### Homebrew (macOS & Linux)

```bash
brew install keywaysh/tap/keyway
```

### Install Script

```bash
curl -fsSL https://keyway.sh/install.sh | sh
```

### npx (no install)

```bash
npx @keywaysh/cli init
```

### Direct download

Grab the binary for your platform from [Releases](https://github.com/keywaysh/cli/releases/latest).

---

## Quick Start

```bash
keyway init
```

This will:
1. Authenticate with GitHub
2. Create an encrypted vault for your repo
3. Push your local `.env` to the vault

New teammate joins? They run `keyway pull`. Done in 30 seconds.

---

## How It Works

```bash
keyway init          # First time: create vault, push secrets
keyway push          # Update remote secrets
keyway pull          # Get latest secrets
keyway sync vercel   # Deploy to Vercel, Railway, Netlify
```

### Zero-Trust Mode

Never write secrets to disk. Inject them directly into your process:

```bash
keyway run -- npm start
keyway run -e production -- ./my-app
```

Secrets exist only in memory. When the process exits, they're gone.

---

## Security

Your secrets are protected by:

| Layer | Protection |
|-------|------------|
| **Encryption** | AES-256-GCM with random IV per secret |
| **At Rest** | Encrypted in database, keys in isolated service |
| **In Transit** | TLS 1.3 everywhere |
| **Access Control** | GitHub collaborator API — no separate user management |
| **Audit Trail** | Every pull and view is logged with IP and location |

We can't read your secrets. Even if our database leaks, attackers get encrypted blobs.

[Read our security whitepaper →](https://www.keyway.sh/security)

---

## Commands

| Command | Description |
|---------|-------------|
| `keyway init` | Create vault and push initial secrets |
| `keyway push` | Push local secrets to vault |
| `keyway pull` | Pull secrets from vault |
| `keyway set KEY=VALUE` | Set a single secret in the vault |
| `keyway run` | Run command with secrets injected (zero-trust) |
| `keyway diff` | Compare local vs remote secrets |
| `keyway sync` | Sync to Vercel, Railway, Netlify |
| `keyway connect` | Connect to a provider (Vercel, Railway) |
| `keyway connections` | List connected providers |
| `keyway disconnect` | Remove a provider connection |
| `keyway scan` | Scan repo for leaked secrets |
| `keyway login` | Authenticate with GitHub |
| `keyway logout` | Clear stored credentials |
| `keyway doctor` | Diagnose environment issues |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KEYWAY_TOKEN` | Auth token for CI/CD (create in Dashboard > API Keys) |
| `KEYWAY_API_URL` | Custom API endpoint |
| `KEYWAY_DISABLE_TELEMETRY=1` | Disable anonymous analytics |

---

## Why Keyway?

- **30 seconds** to onboard a new developer
- **0 secrets** to rotate when someone leaves (just revoke GitHub access)
- **1 command** to deploy secrets to production
- **GitHub-native** — no new accounts, no new permissions to manage

---

## CI/CD

Use an API key for automation:

```bash
# Generate an API key (Dashboard > Settings > API Keys)
# Use scope "read:secrets" for CI — least privilege principle
```

```yaml
# GitHub Actions example
env:
  KEYWAY_TOKEN: ${{ secrets.KEYWAY_TOKEN }}
run: keyway pull -e production
```

Or use the [GitHub Action](https://github.com/keywaysh/keyway-action):

```yaml
- uses: keywaysh/keyway-action@v1
  with:
    token: ${{ secrets.KEYWAY_TOKEN }}
    environment: production
```

---

## Development

```bash
# Prerequisites: Go 1.22+

make build          # Build → ./bin/keyway
make test           # Run tests
make lint           # Run golangci-lint
make install        # Install to /usr/local/bin/keyway
```

Releases are automated via GoReleaser on tag push.

---

## Links

- [Documentation](https://docs.keyway.sh)
- [Dashboard](https://keyway.sh)
- [Security](https://keyway.sh/security)
- [Status](https://status.keyway.sh)

---

## License

MIT — see [LICENSE](LICENSE)
