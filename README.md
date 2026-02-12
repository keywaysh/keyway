# Keyway

[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/keyway)](https://www.keyway.sh/vaults/keywaysh/keyway)

GitHub-native secrets management. If you have repo access, you get secret access.

## Quick Start

```bash
git clone git@github.com:keywaysh/keyway.git
cd keyway
./setup.sh
nano .env
docker compose up --build
```

Dashboard: **https://app.keyway.local** | API: **https://api.keyway.local**

> See [SELF-HOSTING.md](SELF-HOSTING.md) for production deployment.

---

## Project Structure

```
keyway/
├── packages/
│   ├── backend/       Fastify 5 API (TypeScript)
│   ├── dashboard/     Next.js 15 dashboard (TypeScript)
│   ├── crypto/        AES-256-GCM gRPC service (Go)
│   ├── cli/           CLI tool (Go)
│   ├── mcp/           MCP server for AI assistants (TypeScript)
│   └── docs/          Docusaurus documentation (TypeScript)
├── proto/             Shared protobuf definitions
├── docker-compose.yml Self-hosting orchestration
├── Caddyfile          Local dev reverse proxy (mkcert)
├── Caddyfile.production  Production reverse proxy (Let's Encrypt)
├── setup.sh           Local dev setup (secrets, hosts, certs)
├── dev.sh             Dev server launcher (hot reload)
├── turbo.json         Turborepo task config
└── pnpm-workspace.yaml
```

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10
- [Go](https://go.dev/) >= 1.24
- [Docker](https://www.docker.com/) (for self-hosting / full stack)

### Install & Build

```bash
pnpm install              # Install all TypeScript dependencies
pnpm build                # Build all TypeScript packages (via Turborepo)

cd packages/cli && make build      # Build CLI binary
cd packages/crypto && make build   # Build crypto service
```

### Dev Server (without Docker)

```bash
./dev.sh                  # Start crypto + backend + dashboard with hot reload
./dev.sh backend          # Backend only
./dev.sh dashboard        # Dashboard only
./dev.sh crypto           # Crypto gRPC only
```

### Dev Server (with Docker)

```bash
docker compose up --build
```

### Per-Package Commands

| Package | Dev | Build | Test | Lint |
|---------|-----|-------|------|------|
| backend | `pnpm --filter keyway-api dev` | `pnpm --filter keyway-api build` | `pnpm --filter keyway-api test` | `pnpm --filter keyway-api lint` |
| dashboard | `pnpm --filter keyway-dashboard dev` | `pnpm --filter keyway-dashboard build` | `pnpm --filter keyway-dashboard test` | `pnpm --filter keyway-dashboard lint` |
| mcp | `pnpm --filter @keywaysh/mcp dev` | `pnpm --filter @keywaysh/mcp build` | `pnpm --filter @keywaysh/mcp test` | `pnpm --filter @keywaysh/mcp lint` |
| docs | `pnpm --filter keyway-docs start` | `pnpm --filter keyway-docs build` | - | - |
| cli | `cd packages/cli && make build` | `cd packages/cli && make build` | `cd packages/cli && make test` | `cd packages/cli && make lint` |
| crypto | `cd packages/crypto && go run .` | `cd packages/crypto && go build .` | `cd packages/crypto && go test ./...` | - |

---

## Configuration

### 1. Generate Keys

```bash
openssl rand -hex 32      # → ENCRYPTION_KEY
openssl rand -base64 32   # → JWT_SECRET
```

### 2. Create a GitHub App

Go to **https://github.com/settings/apps/new**

| Setting | Value |
|---------|-------|
| App name | `keyway-dev` (must be unique) |
| Homepage URL | `https://localhost` |
| Callback URL | `https://api.keyway.local/v1/auth/callback` |
| Webhook | Uncheck "Active" (not needed locally) |
| Permissions | Repository metadata: Read-only |

After creating:
1. Copy **App ID** and **Client ID**
2. Generate a **Client secret**
3. Generate a **Private key** (.pem file), convert to single line:
   ```bash
   awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-app.pem
   ```

### 3. Fill in .env

```env
ENCRYPTION_KEY=<64-char hex>
JWT_SECRET=<base64 string>
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=abc123...
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n
GITHUB_APP_NAME=keyway-dev
```

---

## Docker Compose

```bash
docker compose up --build         # Start (foreground)
docker compose up -d --build      # Start (background)
docker compose logs -f backend    # View logs
docker compose up -d --build dashboard  # Rebuild one service
docker compose down               # Stop
docker compose down -v            # Full reset (wipes database)
docker compose exec db psql -U keyway -d keyway  # Access database
```

---

## Troubleshooting

**Certificate warning** — Expected with mkcert. Click "Advanced" then "Proceed".

**401 errors** — Clear the `keyway_session` cookie for keyway.local.

**Port already in use** — `docker compose down && lsof -i :443`
