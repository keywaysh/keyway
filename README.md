# Keyway Documentation

[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/keyway-docs)](https://www.keyway.sh/vaults/keywaysh/keyway-docs)

Official documentation for [Keyway](https://keyway.sh) - GitHub-native secrets management for dev teams.

**Live docs**: [docs.keyway.sh](https://docs.keyway.sh)

## What is Keyway?

Keyway is a secrets manager that uses GitHub as the source of truth for access control. If you have access to a repo, you get access to its secrets.

```bash
# Initialize vault (authenticates + syncs .env)
npx @keywaysh/cli init

# Pull secrets on another machine
npx @keywaysh/cli pull
```

## Documentation Structure

```
docs/
├── intro.md              # Getting started
├── installation.md       # Installation guide
├── cli.md                # CLI reference
├── api.md                # API reference
├── ci-cd.md              # CI/CD integration
├── mcp.md                # MCP Server for AI tools
├── ai-agents.md          # AI agents integration
├── security.md           # Security & permissions
├── organizations.md      # Organizations & billing
└── integrations.md       # Provider integrations
```

## Local Development

```bash
# Install dependencies
pnpm install

# Start dev server (http://localhost:3000)
pnpm start

# Build for production
pnpm build

# Serve production build locally
pnpm serve
```

## Tech Stack

- [Docusaurus 3](https://docusaurus.io/) - Documentation framework
- Deployed on Cloudflare Pages

## Contributing

1. Edit markdown files in `docs/`
2. Preview locally with `pnpm start`
3. Submit a PR

## Related Repositories

| Repo | Description |
|------|-------------|
| [keyway-backend](https://github.com/keywaysh/keyway-backend) | Fastify API server |
| [cli](https://github.com/keywaysh/cli) | CLI tool (`@keywaysh/cli`) |
| [keyway-dashboard](https://github.com/keywaysh/keyway-dashboard) | Web dashboard |
| [keyway-landing](https://github.com/keywaysh/keyway-landing) | Marketing site |
| [keyway-crypto](https://github.com/keywaysh/keyway-crypto) | Go encryption microservice |

## License

MIT
