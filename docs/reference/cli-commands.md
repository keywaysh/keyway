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
| `--verbose` | Enable debug output |

## keyway login

Authenticate with Keyway using GitHub OAuth.

```bash
keyway login
```

Opens a browser for GitHub authentication. After approval, your token is stored locally.

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
keyway init [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Specify repository (default: auto-detect from git) |

**Requirements:**
- Admin access on the GitHub repository
- Git repository with GitHub remote

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
| `--env <name>` | `local` | Target environment |
| `--file <path>` | `.env` | Source file path |
| `--yes`, `-y` | `false` | Skip confirmation |

**Behavior:**
- Syncs the entire environment
- Secrets not in the file are removed from the environment
- Creates new secrets, updates existing ones

**Example:**

```bash
# Push to local environment
keyway push

# Push to production
keyway push --env production

# Push from custom file
keyway push --file .env.production --env production
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
| `--env <name>` | `local` | Source environment |
| `--output <path>` | `.env` | Output file path |
| `--yes`, `-y` | `false` | Skip confirmation (overwrite) |

**Example:**

```bash
# Pull local environment
keyway pull

# Pull staging to custom file
keyway pull --env staging --output .env.staging
```

---

## keyway env

Manage vault environments.

### keyway env list

List all environments in the vault.

```bash
keyway env list
```

**Output:**

```
Environments for owner/repo:
  - local
  - dev
  - staging
  - production
```

### keyway env create

Create a new environment.

```bash
keyway env create <name>
```

**Requirements:** Admin access

**Naming rules:**
- 2-30 characters
- Lowercase letters, numbers, dashes, underscores
- Must start with a letter

**Example:**

```bash
keyway env create preview
```

### keyway env rename

Rename an environment.

```bash
keyway env rename <old-name> <new-name>
```

**Requirements:** Admin access

All secrets are automatically moved to the new environment name.

**Example:**

```bash
keyway env rename dev development
```

### keyway env delete

Delete an environment and all its secrets.

```bash
keyway env delete <name>
```

**Requirements:** Admin access

:::warning
This permanently deletes all secrets in the environment.
:::

**Example:**

```bash
keyway env delete preview
```

---

## keyway doctor

Run diagnostic checks.

```bash
keyway doctor
```

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

## keyway whoami

Show current user information.

```bash
keyway whoami
```

**Output:**

```
Logged in as: octocat
GitHub ID: 12345
Token expires: 2025-02-15
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
