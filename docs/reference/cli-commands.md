---
sidebar_position: 1
title: CLI Commands
---

# CLI Commands Reference

Complete reference for all Keyway CLI commands.

## Global options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help |
| `--version`, `-V` | Show version |
| `--no-login-prompt` | Fail instead of prompting to login if unauthenticated (useful for CI/CD) |

## keyway login

Authenticate with Keyway using GitHub OAuth.

```bash
keyway login [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--token` | Authenticate using a GitHub fine-grained PAT instead of OAuth |

Opens a browser for GitHub authentication. After approval, your token is stored locally.

**Using a Personal Access Token:**

```bash
keyway login --token
# You will be prompted to enter your GitHub fine-grained PAT
```

**Stored in:** `~/.config/keyway/config.json`

---

## keyway logout

Clear stored authentication.

```bash
keyway logout
```

Removes the locally stored token.

---

## keyway init

Initialize a vault for the current repository.

```bash
keyway init
```

**Requirements:**
- Admin access on the GitHub repository
- Git repository with GitHub remote (auto-detected)

**Example:**

```bash
cd my-project
keyway init
# Output: Vault created for owner/my-project
```

---

## keyway push

Push local secrets to Keyway.

```bash
keyway push [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <name>` | `development` | Target environment |
| `-f, --file <path>` | `.env` | Source file path |
| `-y, --yes` | `false` | Skip confirmation |

**Behavior:**
- Syncs the entire environment
- Secrets not in the file are removed from the environment
- Creates new secrets, updates existing ones

**Example:**

```bash
# Push to development environment (default)
keyway push

# Push to production
keyway push -e production

# Push from custom file
keyway push -f .env.production -e production
```

---

## keyway pull

Pull secrets from Keyway to local file.

```bash
keyway pull [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --env <name>` | `development` | Source environment |
| `-f, --file <path>` | `.env` | Output file path |
| `-y, --yes` | `false` | Skip confirmation (overwrite) |

**Example:**

```bash
# Pull development environment (default)
keyway pull

# Pull staging to custom file
keyway pull -e staging -f .env.staging
```

---

## keyway doctor

Run diagnostic checks.

```bash
keyway doctor [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--json` | `false` | Output results as JSON for machine processing |
| `--strict` | `false` | Treat warnings as failures |

**Checks performed:**

1. **Authentication** - Is the user logged in?
2. **Token validity** - Is the token still valid?
3. **Git repository** - Is this a git repo?
4. **GitHub remote** - Is there a GitHub remote?
5. **Vault existence** - Does a vault exist for this repo?
6. **Permissions** - What access level does the user have?
7. **Network** - Can we reach the Keyway API?

**Example output:**

```
Keyway Doctor
=============

✓ Authenticated as octocat
✓ Token valid (expires in 29 days)
✓ Git repository detected
✓ GitHub remote: owner/repo
✓ Vault exists
✓ Permission level: admin
✓ API reachable

All checks passed!
```

---

## keyway connect

Connect to an external provider for secret syncing.

```bash
keyway connect <provider>
```

**Supported providers:**
- `vercel` - Vercel deployment platform

**Example:**

```bash
keyway connect vercel
# Opens browser to authorize Keyway with Vercel
```

After connecting, you can use `keyway sync` to push secrets to the provider.

---

## keyway connections

List your connected providers.

```bash
keyway connections
```

**Example output:**

```
Connected providers:
  - vercel (connected on 2025-01-15)
```

---

## keyway disconnect

Disconnect from a provider.

```bash
keyway disconnect <provider>
```

**Example:**

```bash
keyway disconnect vercel
```

---

## keyway sync

Sync secrets between Keyway and a provider.

```bash
keyway sync <provider> [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-e, --environment <env>` | `production` | Keyway environment to sync from |
| `--provider-env <env>` | `production` | Provider environment to sync to |
| `--project <project>` | - | Provider project name or ID |
| `--pull` | `false` | Import secrets from provider to Keyway (reverse sync) |
| `--allow-delete` | `false` | Allow deleting secrets not present in source |
| `-y, --yes` | `false` | Skip confirmation prompt |

**Example:**

```bash
# Sync production secrets to Vercel
keyway sync vercel

# Sync staging environment to Vercel preview
keyway sync vercel -e staging --provider-env preview

# Sync to a specific Vercel project
keyway sync vercel --project my-app

# Import secrets from Vercel into Keyway
keyway sync vercel --pull

# Sync and delete secrets not in Keyway
keyway sync vercel --allow-delete -y
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `KEYWAY_TOKEN` | Authentication token (overrides stored token) |
| `KEYWAY_API_URL` | API URL (default: `https://api.keyway.sh`) |
| `KEYWAY_DISABLE_TELEMETRY` | Set to `1` to disable anonymous usage analytics |

**Example:**

```bash
# Use a specific token
KEYWAY_TOKEN=ghp_xxx keyway pull

# Use a different API endpoint
KEYWAY_API_URL=https://api.staging.keyway.sh keyway pull
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication required |
| 3 | Vault not found |
| 4 | Permission denied |
| 5 | Network error |
