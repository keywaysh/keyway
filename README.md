# keyway-infra

Local development infrastructure for Keyway.

## Quick Start

```bash
# Start all services
docker-compose up

# Or use the dev script
./dev.sh
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| db | 5433 | PostgreSQL database |
| crypto | 50051 | Go encryption microservice (gRPC) |
| backend | 3000 | Fastify API |
| site | 3100 | Next.js frontend |
| caddy | 443 | HTTPS reverse proxy |

## Local URLs

- **Frontend**: https://keyway.localhost
- **API**: https://api.keyway.localhost
- **Direct API**: http://localhost:3000

## Files

| File | Description |
|------|-------------|
| `docker-compose.yml` | Docker Compose configuration |
| `Caddyfile` | Caddy reverse proxy config (HTTPS) |
| `dev.sh` | Development helper script |
| `keyway-local` | CLI wrapper for local testing |
| `CLAUDE.md` | Claude Code instructions |

## Testing CLI locally

```bash
# From any repo directory
../keyway-infra/keyway-local push
../keyway-infra/keyway-local pull
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:
- `ENCRYPTION_KEY` - 64 hex chars for AES-256
- `JWT_SECRET` - JWT signing secret
- `GITHUB_CLIENT_ID` - GitHub OAuth app ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app secret
