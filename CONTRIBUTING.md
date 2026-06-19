# Contributing — local development

Keyway runs as a small stack: Postgres + a crypto gRPC service + the Fastify
backend + the Next.js dashboard, fronted by Caddy. There are **two ways** to run
it locally — pick one and stick to it:

| Mode | Command | URLs | When |
|------|---------|------|------|
| **Docker + Caddy** (recommended) | `make docker` | `https://app.keyway.local` / `https://api.keyway.local` | Default. Matches production topology (pg16, TLS, same hostnames). |
| Native | `make dev` | open **http://localhost:3001** (the app; backend runs on :3000) | Only if you can't use Docker. Needs **localhost** env values — set `DATABASE_URL` and `CRYPTO_SERVICE_URL` to `localhost` (not `db`/`crypto`). |

> ⚠️ The two modes need **different** env values. Mixing them is the #1 source of
> local-setup pain. Run `make doctor` anytime to see which mode your `.env` is
> configured for and what's missing.

## Quick start (Docker + Caddy)

```bash
make setup                       # /etc/hosts entries + mkcert certs (one-time)
keyway login                     # against the prod Keyway (you have repo access)
keyway pull -e dev               # hydrate .env from the shared dev vault
make doctor                      # sanity-check the setup
make docker                      # build + run the full stack
```

Then open **https://app.keyway.local** and sign in.

## The env profile (what `make doctor` checks)

Local dev needs these set in `.env`:

| Var | Docker value | Why |
|-----|--------------|-----|
| `DOMAIN` | `keyway.local` | URLs become `*.keyway.local` (must match the GitHub App callback) |
| `CADDYFILE` | `./Caddyfile` | use the mkcert certs, **not** the prod `Caddyfile.production` (real ACME) |
| `DATABASE_URL` | `postgresql://keyway:keyway@db:5432/keyway` | `db` resolves inside the Docker network |
| `CRYPTO_SERVICE_URL` | `crypto:50051` | `crypto` resolves inside the Docker network |
| `GITHUB_APP_NAME` | your App's **public slug** | the install URL is `github.com/apps/<slug>` — the placeholder `keyway-app` 404s |
| `GITHUB_APP_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_PRIVATE_KEY` | from your dev GitHub App | auth + repo access |

The hostnames `db` / `crypto` only resolve **inside** the Docker network — if you
run `make dev` natively, point `DATABASE_URL`/`CRYPTO_SERVICE_URL` at `localhost`
instead. `make doctor` warns when these are mismatched for the mode you're using.

## GitHub App

You need a dev GitHub App (separate from production). It must have:

- **Authorization callback URL**: `https://api.keyway.local/v1/auth/callback`
- **Organization permissions → Members: Read** (so the org member roster and role
  detection work — without it the API only returns *public* org members)

The dashboard auto-targets the local backend in dev (`NEXT_PUBLIC_KEYWAY_API_URL`
defaults to `http://localhost:3000` when `NODE_ENV !== production`); set it
explicitly only if your backend runs elsewhere.

## Webhooks (optional, for org creation/sync)

GitHub can't reach `https://api.keyway.local`, so `installation` / org-membership
webhooks don't arrive locally — org creation falls back to the in-app "Connect"
flow (the Connect Organization modal), and member sync can be triggered manually.
To exercise the real webhook path locally, forward webhooks with a tunnel:

```bash
# e.g. smee.io or cloudflared — point the GitHub App webhook URL at the tunnel,
# and forward to https://api.keyway.local/v1/github/webhooks
```

## Tests

```bash
make test                        # all packages
pnpm --filter keyway-api test    # backend (unit + integration)
```

Backend integration tests need a Postgres reachable at the URL in
`tests/integration-db/setup.ts`. Unit tests use a mocked DB.

## Before you push

```bash
make lint
make test
```
