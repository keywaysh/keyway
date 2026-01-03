---
sidebar_position: 3
title: CLI Reference
---

# CLI Reference

```bash
npx @keywaysh/cli init
```

Or install globally:

```bash npm2yarn
npm install -g @keywaysh/cli
```

```bash title="Homebrew (macOS/Linux)"
brew install keywaysh/tap/keyway
```

## Commands

### keyway init

Initialize a vault for the current repository. Requires admin access.

```bash
keyway init
```

If not logged in, opens browser for GitHub OAuth.

---

### keyway push

Push local secrets to Keyway.

```bash
keyway push [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <name>` | `development` | Target environment |
| `-f, --file <path>` | `.env` | Source file |
| `-y, --yes` | `false` | Skip confirmation |

```bash
keyway push                              # Push .env to development
keyway push -e production                # Push to production
keyway push -f .env.prod -e production   # Custom file
```

:::caution Full sync
Push replaces all secrets in the environment. If a secret exists in Keyway but not in your local file, it will be **deleted**.
:::

---

### keyway pull

Pull secrets from Keyway to local file.

```bash
keyway pull [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <name>` | `development` | Source environment |
| `-f, --file <path>` | `.env` | Output file |
| `-y, --yes` | `false` | Skip confirmation |

```bash
keyway pull                          # Pull development to .env
keyway pull -e staging               # Pull staging
keyway pull -e staging -f .env.stg   # Compare environments
```

---

### keyway run

Run a command with secrets injected into the environment. Secrets are fetched from the vault and kept in memory (RAM) only, never written to disk.

```bash
keyway run [options] -- <command>
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <name>` | `development` | Environment to use |

```bash
# Run with default environment (development)
keyway run -- npm run dev

# Run with specific environment
keyway run -e production -- ./deploy.sh

# Run any command
keyway run -- python3 script.py
```

### AI Agents Integration

When using AI coding assistants like **Claude Code**, **Gemini CLI**, or **GitHub Copilot CLI**, you want to avoid giving them access to your `.env` files (which they can read if they are on disk).

`keyway run` solves this:
1. The AI agent runs `keyway run -- npm test`.
2. Secrets are injected in memory.
3. Tests pass.
4. The AI never sees the actual secret values, only the success/failure output.

:::tip Zero-Trust
This is the most secure way to use secrets locally or in CI/CD, as no `.env` file is created.
:::

---

### keyway doctor

Run diagnostic checks.

```bash
keyway doctor [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--strict` | Treat warnings as failures |

Checks: authentication, token validity, git repo, GitHub remote, vault existence, permissions, network.

---

### keyway login

Authenticate with GitHub.

```bash
keyway login           # OAuth (opens browser)
keyway login --token   # Use fine-grained PAT
```

Token stored in `~/.config/keyway-nodejs/config.json` (Linux), `~/Library/Preferences/keyway-nodejs/config.json` (macOS)

---

### keyway logout

Clear stored authentication.

```bash
keyway logout
```

---

### keyway connect

Connect to an external provider.

```bash
keyway connect <provider>
```

Providers: `vercel`, `netlify`, `railway`

```bash
keyway connect vercel   # Opens browser for OAuth
```

---

### keyway connections

List connected providers.

```bash
keyway connections
```

---

### keyway disconnect

Disconnect from a provider.

```bash
keyway disconnect <provider>
```

---

### keyway sync

Sync secrets with a provider.

```bash
keyway sync <provider> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --environment <env>` | `production` | Keyway environment |
| `--provider-env <env>` | `production` | Provider environment |
| `--project <name>` | - | Provider project |
| `--pull` | `false` | Import from provider |
| `--allow-delete` | `false` | Delete missing secrets |
| `-y, --yes` | `false` | Skip confirmation |

```bash
keyway sync vercel                              # Push to Vercel
keyway sync vercel -e staging --provider-env preview
keyway sync vercel --pull                       # Import from Vercel
keyway sync vercel --allow-delete -y            # Full sync
```

---

## Global Options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help |
| `--version`, `-V` | Show version |
| `--no-login-prompt` | Fail if not authenticated (for CI/CD) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KEYWAY_TOKEN` | Override stored token |
| `KEYWAY_API_URL` | API URL (default: `https://api.keyway.sh`) |
| `KEYWAY_DISABLE_TELEMETRY` | Set `1` to disable analytics |

```bash
KEYWAY_TOKEN=ghp_xxx keyway pull
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication required |
| 3 | Vault not found |
| 4 | Permission denied |
| 5 | Network error |

---

## Scripting

```bash
#!/bin/bash
set -e
keyway pull --yes
npm start
```

---

## Troubleshooting

**"No vault found"** → Run `keyway init`

**"Authentication required"** → Run `keyway login`

**"Permission denied"** → Need GitHub repo access

**Debug mode:**
```bash
keyway pull --verbose
```