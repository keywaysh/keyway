# Keyway Dashboard

[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/keyway-dashboard)](https://www.keyway.sh/vaults/keywaysh/keyway-dashboard)
[![Release](https://img.shields.io/github/v/release/keywaysh/keyway-dashboard?color=34D399)](https://github.com/keywaysh/keyway-dashboard/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**The web dashboard for [Keyway](https://keyway.sh)** — GitHub-native secrets management.

<p align="center">
  <img src=".github/screenshot.png" alt="Keyway Dashboard" width="800">
</p>

---

## Features

- **Visual secret management** — Create, edit, and organize secrets across environments
- **Provider sync** — Push secrets to Vercel, Railway, Netlify
- **Team collaboration** — GitHub-based permissions, no separate access control
- **Audit trail** — See who accessed what, when, and from where
- **Security alerts** — Get notified of suspicious access patterns
- **Version history** — Track changes and restore previous values
- **Soft delete** — 30-day recovery window for deleted secrets

---

## Quick Start

1. Go to [app.keyway.sh](https://app.keyway.sh)
2. Sign in with GitHub
3. Create your first vault from any repo you have access to

> **Prefer the CLI?** Run `brew install keywaysh/tap/keyway && keyway init`

---

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui |
| Data | React Query |
| Auth | GitHub OAuth |

---

## Development

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Running [keyway-backend](https://github.com/keywaysh/keyway-backend)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env.local

# Start dev server
pnpm dev
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint code |

---

## Related

- [cli](https://github.com/keywaysh/cli) — Command-line tool
- [keyway-backend](https://github.com/keywaysh/keyway-backend) — API server
- [keyway-mcp](https://github.com/keywaysh/keyway-mcp) — MCP server for AI assistants
- [keyway-action](https://github.com/keywaysh/keyway-action) — GitHub Action
- [keyway-docs](https://github.com/keywaysh/keyway-docs) — Documentation

---

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) for reporting guidelines.

---

## License

MIT
