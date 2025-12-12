# Keyway MCP Server

MCP (Model Context Protocol) server for [Keyway](https://keyway.sh) - a GitHub-native secrets management platform. This server allows LLMs like Claude to securely access and manage secrets without exposing them in conversation context.

## Features

- **List secrets** - View secret names without exposing values
- **Get secret** - Retrieve a specific secret value for programmatic use
- **Set secret** - Create or update secrets
- **Inject & run** - Execute commands with secrets injected as environment variables
- **List environments** - View available environments (development, staging, production)

## Installation

```bash
# Clone and build
cd keyway-mcp
pnpm install
pnpm build
```

## Prerequisites

You must be logged in with the Keyway CLI:

```bash
# Install Keyway CLI
npm install -g @keywaysh/cli

# Login
keyway login
```

## Usage with Claude Desktop

Add to your `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "keyway": {
      "command": "node",
      "args": ["/path/to/keyway-mcp/dist/index.js"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Replace `/path/to/keyway-mcp` with the actual path and `/path/to/your/project` with your project directory (must be a git repo with GitHub remote).

## Usage with Claude Code

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "keyway": {
      "command": "node",
      "args": ["/path/to/keyway-mcp/dist/index.js"]
    }
  }
}
```

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
