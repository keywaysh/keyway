# Keyway CLI

**GitHub-native secrets management.** Repo access = secret access.

[![Release](https://img.shields.io/github/v/release/keywaysh/cli?label=release&color=34D399)](https://github.com/keywaysh/cli/releases/latest)
[![CI](https://github.com/keywaysh/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/keywaysh/cli/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/keywaysh/cli/graph/badge.svg?token=O3LRCDFKLS)](https://codecov.io/github/keywaysh/cli)
[![Go Report Card](https://goreportcard.com/badge/github.com/keywaysh/cli)](https://goreportcard.com/report/github.com/keywaysh/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/cli)](https://www.keyway.sh/vaults/keywaysh/cli)

<!-- TODO: replace with a 15s GIF of `keyway init` → `keyway run` -->

```text
  You                          Teammate
  ─────────────────            ─────────────────
  $ keyway init                $ keyway run -- npm start
  ✓ Logged in via GitHub       ✓ Logged in via GitHub
  ✓ Vault created              ✓ Injected 12 secrets
  ✓ Pushed 12 secrets          ✓ Server running
  Ready.                       Ready. No .env on disk.
```

---

## Quick Start

```bash
brew install keywaysh/tap/keyway
```

<details>
<summary>Other install methods</summary>

```bash
# Install script (macOS & Linux)
curl -fsSL https://keyway.sh/install.sh | sh

# npx (no install)
npx @keywaysh/cli init

# Direct download
# Grab the binary for your platform from Releases:
# https://github.com/keywaysh/cli/releases/latest
```

</details>

Then, from your repo:

```bash
keyway init                  # Create vault, push secrets
keyway run -- npm start      # Run with secrets injected, nothing on disk
```

A teammate clones the repo and runs:

```bash
keyway run -- npm start      # Secrets injected — 30 seconds from install to running
```

---

## How It Works

```bash
keyway init          # First time: create vault, push secrets
keyway run           # Run with secrets injected (nothing on disk)
keyway push          # Update remote secrets
keyway pull          # Download secrets as .env (when you need the file)
keyway diff          # Compare local vs remote before pushing
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

## Works with AI Assistants

AI coding agents can read your `.env` files. Keyway keeps secrets out of AI context.

### `keyway run` — secrets never touch disk

The AI sees command output but never secret values:

```bash
keyway run -- npm test        # AI sees "tests passed", not your DB password
keyway run -- npm run dev     # Secrets in RAM only, invisible to agents
```

### MCP Server — AI manages secrets without seeing them

5 tools your AI assistant can use — `keyway_list_secrets`, `keyway_get_secret`, `keyway_set_secret`, `keyway_inject_run`, and `keyway_list_environments` — with values always masked:

```bash
# Claude Code
claude mcp add keyway -- npx @keywaysh/mcp

# VS Code / Cursor
code --add-mcp '{"name":"keyway","command":"npx","args":["@keywaysh/mcp"]}'
```

Works with Claude Code, VS Code, Cursor, Windsurf, Warp, GitHub Copilot*, and Goose.

*GitHub Copilot supports MCP tools only (not resources or prompts).

[MCP Server docs →](https://github.com/keywaysh/keyway-mcp) · [AI agents guide →](https://docs.keyway.sh/ai-agents)

---

## Security

Your secrets are protected by:

| Layer | Protection |
|-------|------------|
| **Encryption** | AES-256-GCM with random IV per secret |
| **At Rest** | Encrypted in database, keys in isolated Go crypto microservice |
| **In Transit** | TLS 1.3 everywhere |
| **Access Control** | GitHub collaborator API — no separate user management |
| **Audit Trail** | Every pull and view is logged with IP and location |

We can't read your secrets. Even if our database leaks, attackers get encrypted blobs.

Self-hostable — run the entire stack on your own infrastructure with Docker Compose.

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

## Why Keyway?

- **30 seconds** to onboard a new developer
- **0 secrets** to rotate when someone leaves (just revoke GitHub access)
- **1 command** to deploy secrets to production
- **GitHub-native** — no new accounts, no new permissions to manage
- **First-class AI support** — MCP server and zero-trust mode keep secrets out of AI context
- **Fully open-source** — MIT licensed, self-hostable, auditable

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KEYWAY_TOKEN` | Auth token for CI/CD (create in Dashboard > API Keys) |
| `KEYWAY_API_URL` | Custom API endpoint |
| `KEYWAY_DISABLE_TELEMETRY=1` | Disable anonymous analytics |

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
- [MCP Server](https://github.com/keywaysh/keyway-mcp)
- [GitHub Action](https://github.com/keywaysh/keyway-action)
<!-- TODO: add self-hosting guide link when docs page is live -->
- [Status](https://status.keyway.sh)

---

## License

MIT — see [LICENSE](LICENSE)
