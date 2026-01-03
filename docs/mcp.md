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
npx @keywaysh/cli login
```

---

## Available Tools

### keyway_list_secrets

List secret names (without values).

```json
{ "environment": "production" }
```

### keyway_get_secret

Get a specific secret value.

```json
{
  "name": "DATABASE_URL",
  "environment": "production"
}
```

### keyway_set_secret

Create or update a secret.

```json
{
  "name": "API_KEY",
  "value": "sk-...",
  "environment": "production"
}
```

### keyway_inject_run

Run a command with secrets as env vars.

```json
{
  "command": "npm",
  "args": ["run", "dev"],
  "environment": "development",
  "timeout": 300000
}
```

### keyway_list_environments

List available environments.

```json
{}
```

---

## Example Prompts

**"What secrets are in production?"**
→ Uses `keyway_list_secrets`

**"Get the DATABASE_URL for staging"**
→ Uses `keyway_get_secret`

**"Run the tests with the development secrets"**
→ Uses `keyway_inject_run`

**"Add a new API_KEY secret with value xyz"**
→ Uses `keyway_set_secret`

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
