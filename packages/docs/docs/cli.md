---
sidebar_position: 3
title: CLI Reference
---

# CLI Reference

```bash
brew install keywaysh/tap/keyway
```

See [Installation](/installation) for other methods (Linux, Windows, npm).

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
| `--prune` | `false` | Remove secrets from vault not in local file |
| `-y, --yes` | `false` | Skip confirmation |

```bash
keyway push                              # Push .env to development
keyway push -e production                # Push to production
keyway push -f .env.prod -e production   # Custom file
keyway push --prune                      # Remove secrets not in local file
```

:::tip Additive by default
Push is additive — existing secrets not in your local file are preserved. Use `--prune` to remove them.
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

### keyway set

Set a single secret in the vault.

```bash
keyway set <KEY> [VALUE] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <name>` | `development` | Target environment |
| `-y, --yes` | `false` | Skip confirmation |

```bash
keyway set API_KEY                     # Prompt for value (masked)
keyway set API_KEY=sk_live_xxx         # Set with inline value
keyway set API_KEY -e production       # Set in specific environment
```

:::tip Quick updates
Use `keyway set` for quick, single-secret updates without touching your `.env` file. Perfect for rotating a single key.
:::

---

### keyway diff

Compare secrets between two environments.

```bash
keyway diff [env1] [env2] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--show-values` | `false` | Show actual value differences (sensitive!) |
| `--keys-only` | `false` | Only show key names |
| `--json` | `false` | Output as JSON |

```bash
keyway diff                              # Interactive selection
keyway diff production staging           # Compare two environments
keyway diff dev prod --show-values       # Show value differences
```

---

### keyway scan

Scan files for potential secret leaks (API keys, tokens, passwords).

```bash
keyway scan [path] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --exclude <pattern>` | - | Additional directories to exclude |
| `--json` | `false` | Output as JSON (for CI) |
| `--show-all` | `false` | Show all matches including potential false positives |

```bash
keyway scan                        # Scan current directory
keyway scan ./src                  # Scan specific directory
keyway scan --json                 # For CI/CD integration
keyway scan -e test -e fixtures    # Exclude directories
```

:::caution Pre-commit hook
Consider adding `keyway scan` to your pre-commit hooks to catch leaks before they reach git history.
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

Token stored securely in the system keyring (macOS Keychain, Linux Secret Service, Windows Credential Manager).

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

Supported providers: `vercel`, `railway`, `netlify`

```bash
keyway connect vercel    # Opens browser for Vercel OAuth
keyway connect railway   # Prompts for Railway API token
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

### keyway readme

Add a Keyway badge to your project's README.

```bash
keyway readme
```

Automatically adds a badge showing your vault status to your README.md file.

---

### keyway sync

Sync secrets with a provider.

```bash
keyway sync <provider> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <env>` | `production` | Keyway environment |
| `--provider-env <env>` | `production` | Provider environment |
| `--project <name>` | - | Provider project |
| `--team <name>` | - | Filter by team/organization |
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