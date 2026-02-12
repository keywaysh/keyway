<div align="center">
  <h1>Keyway</h1>
  <p><strong>GitHub-native secrets management.</strong> Repo access = secret access.</p>

  <p>
    <a href="https://docs.keyway.sh">Docs</a> ·
    <a href="https://keyway.sh">Website</a> ·
    <a href="https://app.keyway.sh">Dashboard</a> ·
    <a href="https://github.com/keywaysh/keyway/tree/main/packages/cli">CLI</a>
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
| [keyway](https://github.com/keywaysh/keyway) | Monorepo: CLI, API, dashboard, crypto, MCP, docs |
| [keyway-action](https://github.com/keywaysh/keyway-action) | GitHub Action for CI/CD |
| [keyway-landing](https://github.com/keywaysh/keyway-landing) | Marketing site |

---

<div align="center">
  <a href="https://docs.keyway.sh"><strong>Get Started →</strong></a>
  <br><br>
  <sub>Built by <a href="https://github.com/NicolasRitouet">@NicolasRitouet</a></sub>
</div>
