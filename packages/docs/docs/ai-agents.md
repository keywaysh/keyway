---
sidebar_position: 7
title: AI Agents
---

# AI Agents

Use secrets with AI coding assistants without exposing them.

## The Problem

AI coding agents like Claude Code, Gemini CLI, or Codex CLI have access to your entire codebase. This includes your `.env` files.

```
your-project/
├── src/
├── package.json
└── .env          ← The AI can read this
```

You trust the AI to write code, not to see your Stripe keys, database passwords, or API tokens.

## The Solution: `keyway run`

`keyway run` injects secrets into your command's environment **in memory only**. No file is created on disk.

```bash
keyway run -- npm run dev
```

The AI agent sees the command output (success/failure), but never the secret values.

### How It Works

1. Keyway fetches secrets from the vault
2. Secrets are injected into the process environment (RAM)
3. Your command runs with full access to secrets
4. Process exits, secrets are gone

No `.env` file is written. Nothing persists on disk.

---

## Supported AI Tools

### Claude Code

```bash
# Instead of running commands directly, use keyway run
keyway run -- npm test
keyway run -- npm run build
keyway run -e production -- ./deploy.sh
```

Claude Code executes the command, sees the output, but cannot access the secret values.

:::tip MCP Integration
For deeper integration, Claude Code can also use the [Keyway MCP server](/mcp) to list and manage secrets directly.
:::

### Gemini CLI

```bash
# Run with secrets injected
keyway run -- gemini "run the tests and fix any failures"
```

Or wrap your dev commands:

```bash
keyway run -- npm run dev
# Then use Gemini CLI in another terminal
```

### GitHub Copilot CLI

```bash
keyway run -- gh copilot suggest "deploy to production"
```

### Codex CLI (OpenAI)

```bash
keyway run -- codex "run the test suite"
```

### Aider

```bash
keyway run -- aider --model claude-3-opus
```

Aider runs inside the keyway environment with access to all secrets.

### Cursor / Windsurf / VS Code

For IDE-based AI tools, use the [MCP server](/mcp) instead. It provides:
- `keyway_get_secret` - Read a specific secret
- `keyway_list_secrets` - List available secrets (names only)
- `keyway_inject_run` - Run commands with secrets

```bash
# Install MCP server for Cursor
# Settings → MCP → Add new MCP Server
# Command: npx
# Args: -y @keywaysh/mcp
```

---

## Workflows

### Local Development

```bash
# Start your dev server with secrets
keyway run -- npm run dev

# AI agent can now interact with your running app
# without ever seeing the secret values
```

### Running Tests

```bash
# AI agent asks to run tests
keyway run -- npm test

# Tests pass/fail, AI sees output
# DATABASE_URL, API_KEY, etc. stay hidden
```

### Database Migrations

```bash
# AI agent needs to run migrations
keyway run -- npx prisma migrate dev

# Migration runs with DATABASE_URL
# AI only sees migration output
```

### Production Deploys

```bash
# Deploy with production secrets
keyway run -e production -- ./deploy.sh
```

---

## Security Model

| Approach | Secret Location | AI Can Read? |
|----------|-----------------|--------------|
| `.env` file on disk | Filesystem | Yes |
| `keyway run` | Process memory (RAM) | No |
| MCP server | API call, masked output | No (names only) |

### What the AI Sees

**With `.env` file:**
```
AI reads: DATABASE_URL=postgres://user:password@host:5432/db
```

**With `keyway run`:**
```
AI sees: ✓ Tests passed (15/15)
```

The AI gets the information it needs (tests passed) without the information it doesn't need (your database password).

---

## Best Practices

### 1. Never commit `.env` files

Add to `.gitignore`:
```
.env
.env.*
!.env.example
```

### 2. Use `keyway run` for all secret-dependent commands

```bash
# Instead of
npm run dev  # reads .env from disk

# Use
keyway run -- npm run dev  # secrets in memory only
```

### 3. Create a `.env.example` for the AI

```bash title=".env.example"
# Database
DATABASE_URL=postgres://localhost:5432/myapp

# Stripe (get from dashboard.stripe.com)
STRIPE_SECRET_KEY=sk_test_xxx

# Auth
JWT_SECRET=generate-a-random-string
```

The AI can read this to understand what secrets exist, without seeing real values.

### 4. Use MCP for read-only access

If the AI needs to know what secrets exist (not their values):

```bash
# Claude Code with MCP
claude mcp add keyway npx @keywaysh/mcp
```

Then the AI can ask: "What secrets are configured for production?" and get a list of names.

---

## Comparison

| Feature | `.env` file | `keyway run` | MCP Server |
|---------|-------------|--------------|------------|
| Secrets on disk | Yes | No | No |
| AI can read values | Yes | No | No |
| AI can list names | Yes | No | Yes |
| AI can run commands | Yes | Yes | Yes |
| Audit trail | No | Yes | Yes |
| Works offline | Yes | No | No |

---

## FAQ

### Can I use both `keyway run` and MCP?

Yes. Use `keyway run` for executing commands, and MCP for the AI to query what secrets exist.

### What if I need the AI to see a specific secret?

Use the MCP server's `keyway_get_secret` tool. The AI explicitly requests a secret by name, and the access is logged in your audit trail.

### Does this work in CI/CD?

Yes. See [CI/CD Integration](/ci-cd) for GitHub Actions setup. The same principle applies: secrets are injected at runtime, never written to disk.

### What about `.env.local` or `.env.development`?

`keyway run` replaces all of these. One command, one source of truth:

```bash
keyway run -e development -- npm run dev
keyway run -e staging -- npm run build
keyway run -e production -- npm start
```
