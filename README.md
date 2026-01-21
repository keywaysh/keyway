<div align="center">

# Keyway MCP Server

**Let AI manage your secrets securely**

[![npm version](https://img.shields.io/npm/v/@keywaysh/mcp.svg)](https://www.npmjs.com/package/@keywaysh/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

[Keyway](https://keyway.sh) is a GitHub-native secrets manager. This MCP server lets AI assistants like Claude securely access your secrets **without ever exposing them in conversation**.

[Installation](#quick-install) · [Tools](#available-tools) · [Security](#security) · [Development](#development)

</div>

---

## Why Keyway MCP?

Traditional secret management with AI is risky: copying secrets into chat exposes them in logs and context. Keyway MCP solves this:

| Without Keyway | With Keyway MCP |
|----------------|-----------------|
| Copy secrets into chat | Secrets stay in vault |
| Visible in conversation history | Never exposed to AI |
| Manual secret creation | Generate securely, never exposed |
| Hope AI doesn't leak them | Cryptographically protected |

**Key features:**
- **Zero exposure** — Generate, validate, and use secrets without the AI ever seeing them
- **Pre-deployment validation** — Check all required secrets exist before shipping
- **Secret scanning** — Detect leaked credentials in your codebase
- **Environment diffing** — Compare secrets across dev/staging/prod

---

## Quick Install

### Prerequisites

First, install and authenticate with Keyway CLI:

```bash
brew install keywaysh/tap/keyway
keyway login
```

### Claude Code

```bash
claude mcp add keyway -- npx @keywaysh/mcp
```

### VS Code / Cursor

```bash
code --add-mcp '{"name":"keyway","command":"npx","args":["-y","@keywaysh/mcp"]}'
```

Or click: [Install in VS Code](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22keyway%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40keywaysh%2Fmcp%22%5D%7D)

### Other IDEs

<details>
<summary><b>Windsurf</b></summary>

Add to your MCP config:
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
</details>

<details>
<summary><b>Warp</b></summary>

**Settings** → **AI** → **Manage MCP Servers** → **Add**:
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
</details>

<details>
<summary><b>GitHub Copilot</b></summary>

```bash
/mcp add
```
Then enter `npx -y @keywaysh/mcp` when prompted.
</details>

<details>
<summary><b>Goose</b></summary>

**Advanced settings** → **Extensions** → **Add custom extension**

Select `STDIO` type, command: `npx -y @keywaysh/mcp`
</details>

---

## Available Tools

### `keyway_generate`

Generate secure secrets and store them directly in the vault. **The value is never exposed to the AI.**

```
"Generate a new JWT secret for production"
```

```json
{
  "name": "JWT_SECRET",
  "type": "jwt-secret",
  "environment": "production"
}
```

**Types:** `password` | `uuid` | `api-key` | `jwt-secret` | `hex` | `base64`

**Response:**
```json
{
  "success": true,
  "action": "created",
  "name": "JWT_SECRET",
  "type": "jwt-secret",
  "length": 43,
  "preview": "eyJh**********************************MDkz",
  "message": "Secret created. The actual value was never exposed in this conversation."
}
```

---

### `keyway_validate`

Validate required secrets exist before deployment. Supports auto-detection from code.

```
"Check if production has all required secrets"
```

```json
{
  "environment": "production",
  "required": ["DATABASE_URL", "STRIPE_SECRET_KEY", "JWT_SECRET"]
}
```

**Or auto-detect from your codebase:**

```json
{
  "environment": "production",
  "autoDetect": true
}
```

**Response:**
```json
{
  "valid": false,
  "missing": ["STRIPE_SECRET_KEY"],
  "present": ["DATABASE_URL", "JWT_SECRET"],
  "stats": {
    "requiredCount": 3,
    "presentCount": 2,
    "coverage": "66.7%"
  },
  "message": "✗ Missing 1 required secret in production: STRIPE_SECRET_KEY"
}
```

---

### `keyway_scan`

Scan your codebase for leaked secrets. Detects 18+ secret types.

```
"Scan the codebase for leaked credentials"
```

```json
{
  "path": "./src"
}
```

**Detects:** AWS keys, GitHub tokens, Stripe keys, Slack webhooks, private keys, and more.

**Response:**
```json
{
  "filesScanned": 142,
  "findingsCount": 2,
  "findings": [
    {
      "file": "src/config.ts",
      "line": 23,
      "type": "GitHub PAT",
      "preview": "ghp_********************************xyz"
    }
  ]
}
```

---

### `keyway_diff`

Compare secrets between environments.

```
"What's different between staging and production?"
```

```json
{
  "env1": "staging",
  "env2": "production"
}
```

**Response:**
```json
{
  "onlyInEnv1": ["DEBUG_MODE"],
  "onlyInEnv2": ["REDIS_CLUSTER_URL"],
  "different": [
    {
      "key": "DATABASE_URL",
      "preview1": "**st (45 chars)",
      "preview2": "**db (52 chars)"
    }
  ],
  "same": ["API_KEY", "JWT_SECRET"],
  "stats": {
    "totalEnv1": 10,
    "totalEnv2": 11,
    "different": 1
  }
}
```

---

### `keyway_inject_run`

Run commands with secrets injected as environment variables.

```
"Run the test suite with production secrets"
```

```json
{
  "command": "npm",
  "args": ["test"],
  "environment": "production"
}
```

Secrets are injected into the command's environment and **masked in any output**.

---

### `keyway_list_secrets`

List secret names (not values) in an environment.

```json
{
  "environment": "production"
}
```

---

### `keyway_set_secret`

Create or update a secret manually.

```json
{
  "name": "WEBHOOK_URL",
  "value": "https://hooks.example.com/abc123",
  "environment": "production"
}
```

---

### `keyway_list_environments`

List available environments for the repository.

---

## Security

Keyway MCP is designed with security as the primary concern:

| Feature | How it works |
|---------|--------------|
| **Token encryption** | Uses AES-256-GCM, same as Keyway CLI |
| **No secret logging** | Values never appear in logs or output |
| **Output masking** | `inject_run` redacts secrets from stdout/stderr |
| **Shell injection prevention** | Commands run with `shell: false` |
| **File permissions** | Validates `~/.keyway/.key` is `0600` |
| **Generate, don't expose** | `keyway_generate` creates secrets without revealing them |

### What the AI can see

| Tool | AI sees value? |
|------|----------------|
| `keyway_generate` | No — only masked preview |
| `keyway_validate` | No — only key names |
| `keyway_scan` | No — only masked previews |
| `keyway_diff` | No — only masked previews |
| `keyway_inject_run` | No — values masked in output |
| `keyway_list_secrets` | No — only key names |
| `keyway_set_secret` | Yes — value provided by user |

---

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

# Lint & format
pnpm lint
pnpm format
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `KEYWAY_API_URL` | Override API URL (default: `https://api.keyway.sh`) |

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

**[keyway.sh](https://keyway.sh)** · Built for developers who care about security

</div>
