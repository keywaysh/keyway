<div align="center">
  <h1>Keyway</h1>
  <p><strong>GitHub-native secrets management.</strong> Repo access = secret access.</p>

  <p>
    <a href="https://docs.keyway.sh">Docs</a> ·
    <a href="https://keyway.sh">Website</a> ·
    <a href="https://app.keyway.sh">Dashboard</a> ·
    <a href="https://github.com/keywaysh/cli">CLI</a>
  </p>
</div>

---

```bash
brew install keywaysh/tap/keyway
keyway init                  # Create vault, push secrets
keyway run -- npm start      # Run with secrets injected, nothing on disk
```

A teammate clones the repo and runs `keyway run -- npm start`. Done in 30 seconds. No `.env` on disk.

---

## Why Keyway?

- **GitHub-native** — If you have repo access, you have secret access. No new accounts, no invites.
- **Zero-trust mode** — `keyway run -- npm start` injects secrets at runtime. Nothing on disk.
- **AI-safe** — Secrets never in `.env` files, never in AI context. MCP server for assistants that need to manage secrets without seeing them.
- **Deploy sync** — Push to Vercel, Netlify, Railway with `keyway sync`.
- **Fully open-source** — MIT licensed, self-hostable, auditable.

---

## Works with AI Assistants

AI coding agents can read your `.env` files. Keyway keeps secrets out of AI context.

```bash
keyway run -- npm start                        # Secrets in RAM only
claude mcp add keyway -- npx @keywaysh/mcp     # MCP server for AI assistants
```

[Learn more →](https://docs.keyway.sh/ai-agents)

---

## Repositories

| Repo | Description |
|------|-------------|
| [cli](https://github.com/keywaysh/cli) | Go CLI (Homebrew, npm, curl) |
| [keyway-backend](https://github.com/keywaysh/keyway-backend) | Fastify 5 API server |
| [keyway-crypto](https://github.com/keywaysh/keyway-crypto) | Go gRPC encryption microservice |
| [keyway-mcp](https://github.com/keywaysh/keyway-mcp) | MCP server for AI assistants |
| [keyway-action](https://github.com/keywaysh/keyway-action) | GitHub Action for CI/CD |
| [keyway-dashboard](https://github.com/keywaysh/keyway-dashboard) | Next.js web dashboard |
| [keyway-landing](https://github.com/keywaysh/keyway-landing) | Marketing site |
| [keyway-docs](https://github.com/keywaysh/keyway-docs) | Documentation (Docusaurus) |

---

<div align="center">
  <a href="https://docs.keyway.sh"><strong>Get Started →</strong></a>
  <br><br>
  <sub>Built by <a href="https://github.com/NicolasRitouet">@NicolasRitouet</a></sub>
</div>
