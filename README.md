# Keyway Documentation

Official documentation for [Keyway](https://keyway.sh) - GitHub-native secrets management for dev teams.

**Live docs**: [docs.keyway.sh](https://docs.keyway.sh)

## What is Keyway?

Keyway is a secrets manager that uses GitHub as the source of truth for access control. If you have access to a repo, you get access to its secrets.

```bash
# Install
npm install -g @keywaysh/cli

# Login with GitHub
keyway login

# Push your .env to Keyway
keyway push

# Pull secrets on another machine
keyway pull
```

## Documentation Structure

```
docs/
├── intro.md              # What is Keyway?
├── quickstart/           # Getting started guides
│   ├── install.md
│   ├── first-vault.md
│   └── team-sharing.md
├── guides/               # How-to guides
│   ├── environments.md
│   ├── ci-cd.md
│   └── security.md
├── api/                  # API reference
│   └── endpoints.md
└── reference/            # CLI & config reference
    ├── cli.md
    └── env-files.md
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
| [keyway-cli](https://github.com/keywaysh/keyway-cli) | CLI tool (`@keywaysh/cli`) |
| [keyway-site](https://github.com/keywaysh/keyway-site) | Marketing site & dashboard |
| [keyway-crypto](https://github.com/NicolasRitouet/keyway-crypto) | Go encryption microservice |

## License

MIT
