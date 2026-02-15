---
sidebar_position: 6
title: MCP Server
---

# MCP Server

The Keyway MCP server allows AI assistants to securely access your secrets.

## Quick Install

### Claude Code

```bash
claude mcp add keyway npx @keywaysh/mcp
```

### VS Code

```bash
code --add-mcp '{"name":"keyway","command":"npx","args":["-y","@keywaysh/mcp"]}'
```

### Cursor

Go to **Settings** → **MCP** → **Add new MCP Server**, then use:
- Command: `npx`
- Args: `-y @keywaysh/mcp`

### Windsurf

Add to your Windsurf MCP config:
```json
{
  "mcpServers": {
    "keyway": {
      "command": "npx",
      "args": ["-y", "@keywaysh/mcp"]
    }
  }
}
```

### Warp

**Settings** → **AI** → **Manage MCP Servers** → **Add**, then use:
```json
{
  "mcpServers": {
    "keyway": {
      "command": "npx",
      "args": ["-y", "@keywaysh/mcp"]
    }
  }
}
```

### GitHub Copilot

```bash
/mcp add
```

Then enter `npx -y @keywaysh/mcp` when prompted.

### Goose

**Advanced settings** → **Extensions** → **Add custom extension**, select `STDIO` type, then use:
- Command: `npx -y @keywaysh/mcp`

---

## Prerequisites

Login with the Keyway CLI:

```bash
keyway login
```

See [Installation](/installation) if you haven't installed the CLI yet.

---

## Available Tools

### keyway_list_secrets

List all secret names in the vault for the current repository. Returns only the keys, not the values.

```json
{ "environment": "production" }
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `environment` | No | Environment to list secrets from (default: `development`) |

### keyway_set_secret

Create or update a secret in the vault.

```json
{
  "name": "API_KEY",
  "value": "sk-...",
  "environment": "production"
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Secret name — must be UPPERCASE_WITH_UNDERSCORES |
| `value` | Yes | Secret value to store |
| `environment` | No | Environment to set secret in (default: `development`) |

### keyway_inject_run

Run a command with secrets injected as environment variables. Secrets are only available to this command and are never written to disk.

```json
{
  "command": "npm",
  "args": ["run", "dev"],
  "environment": "development",
  "timeout": 300000
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `command` | Yes | Executable to run (e.g., `npm`, `python`) |
| `args` | No | Array of arguments |
| `environment` | No | Vault environment (default: `development`) |
| `timeout` | No | Max runtime in milliseconds (default: 300000 = 5min) |

The command runs with `shell: false` to prevent shell injection. Secret values are masked in the output.

### keyway_list_environments

List available environments for the current repository vault.

```json
{}
```

### keyway_generate

Generate a secure secret and store it directly in the vault. The secret value is never exposed in the AI conversation.

```json
{
  "name": "JWT_SECRET",
  "type": "jwt-secret",
  "length": 64,
  "environment": "production"
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Secret name — must be UPPERCASE_WITH_UNDERSCORES |
| `type` | No | Type of secret: `password`, `uuid`, `api-key`, `jwt-secret`, `hex`, `base64` (default: `password`) |
| `length` | No | Length of the secret, 8–256 (default: 32) |
| `environment` | No | Environment to store the secret in (default: `development`) |

### keyway_diff

Compare secrets between two environments to find differences. Shows which keys are missing, added, or have different values (without revealing the values).

```json
{
  "env1": "development",
  "env2": "production"
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `env1` | Yes | First environment (e.g., `development`) |
| `env2` | Yes | Second environment (e.g., `production`) |

### keyway_scan

Scan the codebase for potential secret leaks. Detects AWS keys, GitHub tokens, Stripe keys, private keys, and more.

```json
{
  "path": ".",
  "exclude": ["fixtures"]
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | No | Path to scan (default: current directory) |
| `exclude` | No | Additional directories to exclude from scanning |

### keyway_validate

Validate that required secrets exist in an environment. Useful for pre-deployment checks. Can auto-detect required secrets from your codebase.

```json
{
  "environment": "production",
  "autoDetect": true
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `environment` | Yes | Environment to validate (e.g., `production`) |
| `required` | No | List of required secret names to check |
| `autoDetect` | No | Auto-detect required secrets from codebase (default: `false`) |
| `path` | No | Path to scan for auto-detection (default: current directory) |

---

## Example Prompts

**"What secrets are in production?"**
→ Uses `keyway_list_secrets`

**"Run the tests with the development secrets"**
→ Uses `keyway_inject_run`

**"Add a new API_KEY secret with value xyz"**
→ Uses `keyway_set_secret`

**"Generate a secure JWT secret for production"**
→ Uses `keyway_generate`

**"What's different between staging and production?"**
→ Uses `keyway_diff`

**"Scan the codebase for leaked secrets"**
→ Uses `keyway_scan`

**"Are all required secrets set for production?"**
→ Uses `keyway_validate`

---

## Security

- **Token reuse** - Uses CLI's encrypted token (`~/.keyway/.key`)
- **No logging** - Secret values never logged
- **Output masking** - `inject_run` masks secrets in output
- **Shell injection prevention** - Commands run with `shell: false`
- **Audit trail** - All accesses logged (viewable in dashboard)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KEYWAY_API_URL` | Override API URL |

---

## Troubleshooting

**"Not logged in"** → Run `keyway login`

**"No vault found"** → Ensure `cwd` points to a git repo with GitHub remote

**"Permission denied"** → Check GitHub repo access
