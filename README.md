# Keyway MCP Server

MCP (Model Context Protocol) server for [Keyway](https://keyway.sh) - a GitHub-native secrets management platform. This server allows LLMs like Claude to securely access and manage secrets without exposing them in conversation context.

## Features

- **List secrets** - View secret names without exposing values
- **Get secret** - Retrieve a specific secret value for programmatic use
- **Set secret** - Create or update secrets
- **Inject & run** - Execute commands with secrets injected as environment variables
- **List environments** - View available environments (development, staging, production)

## Quick Install

### Claude Code

```bash
claude mcp add keyway npx @keywaysh/mcp
```

### VS Code

```bash
code --add-mcp '{"name":"keyway","command":"npx","args":["-y","@keywaysh/mcp"]}'
```

Or install via one-click: [Install in VS Code](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22keyway%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40keywaysh%2Fmcp%22%5D%7D)

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

You must be logged in with the Keyway CLI:

```bash
npx @keywaysh/cli login
```

---

## Available Tools

### `keyway_list_secrets`

List all secret names in the vault (without values).

```json
{
  "environment": "production"  // optional, default: "development"
}
```

### `keyway_get_secret`

Get the value of a specific secret.

```json
{
  "name": "DATABASE_URL",      // required
  "environment": "production"  // optional, default: "development"
}
```

### `keyway_set_secret`

Create or update a secret.

```json
{
  "name": "API_KEY",           // required, must be UPPERCASE_WITH_UNDERSCORES
  "value": "sk-...",           // required
  "environment": "production"  // optional, default: "development"
}
```

### `keyway_inject_run`

Run a command with secrets injected as environment variables.

```json
{
  "command": "npm",            // required
  "args": ["run", "dev"],      // optional
  "environment": "development", // optional, default: "development"
  "timeout": 300000            // optional, default: 5 minutes
}
```

### `keyway_list_environments`

List available environments for the repository.

```json
{}
```

## Security

- **Token reuse**: Uses the same encrypted token storage as the Keyway CLI (`~/.keyway/.key`)
- **No logging**: Secret values are never logged
- **Output masking**: The `inject_run` tool masks secret values in command output
- **Shell injection prevention**: Commands run with `shell: false`
- **Name validation**: Secret names must be uppercase with underscores

## Development

```bash
# Install dependencies
pnpm install

# Run in development
pnpm dev

# Build
pnpm build

# Run tests
pnpm test
```

## Environment Variables

- `KEYWAY_API_URL` - Override API URL (default: https://api.keyway.sh)

## License

MIT
