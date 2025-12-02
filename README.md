# Keyway Infrastructure

This repository contains the Docker Compose configuration and infrastructure files to run the full Keyway stack locally.

## Quick Start

### 1. Clone all repositories

Keyway is split into multiple repositories. Clone them all into the same parent directory:

```bash
mkdir keyway && cd keyway

# Clone all repos
git clone git@github.com:keywaysh/keyway-backend.git
git clone git@github.com:keywaysh/keyway-site.git
git clone git@github.com:keywaysh/keyway-cli.git
git clone git@github.com:keywaysh/keyway-crypto.git
git clone git@github.com:keywaysh/keyway-infra.git

# Your directory structure should look like:
# keyway/
# ├── keyway-backend/
# ├── keyway-site/
# ├── keyway-cli/
# ├── keyway-crypto/
# └── keyway-infra/
```

### 2. Copy infrastructure files to the root

```bash
# From the keyway/ directory
cp keyway-infra/docker-compose.root.yml ./docker-compose.yml
cp keyway-infra/Caddyfile.root ./Caddyfile
cp keyway-infra/.env.example ./.env
```

### 3. Configure environment

Edit `.env` with your credentials:

```bash
# Generate keys
openssl rand -hex 32    # For ENCRYPTION_KEY
openssl rand -base64 32 # For JWT_SECRET

# Create a GitHub OAuth App at https://github.com/settings/developers
# Set callback URL to: https://localhost/api/v1/auth/callback
```

### 4. Start the stack

```bash
docker compose up --build
```

### 5. Access the app

| Service | URL |
|---------|-----|
| Dashboard | https://localhost |
| API | https://localhost/api |

> First access will show a certificate warning (self-signed). Click "Advanced" > "Proceed".

---

## Useful Commands

```bash
# Run in background
docker compose up -d --build

# View logs
docker compose logs -f
docker compose logs -f backend

# Rebuild a single service
docker compose up -d --build site

# Stop
docker compose down

# Full reset (including database)
docker compose down -v
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Caddy (HTTPS)                           │
│                      https://localhost                          │
├─────────────────────────────────────────────────────────────────┤
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│   ┌──────────┐        ┌──────────┐        ┌──────────┐          │
│   │   Site   │        │ Backend  │◄──────►│  Crypto  │          │
│   │ (Next.js)│        │(Fastify) │  gRPC  │   (Go)   │          │
│   │  :3000   │        │  :8080   │        │  :50051  │          │
│   └──────────┘        └────┬─────┘        └──────────┘          │
│                            │                                    │
│                            ▼                                    │
│                     ┌──────────────┐                            │
│                     │  PostgreSQL  │                            │
│                     │    :5432     │                            │
│                     └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files

| File | Description |
|------|-------------|
| `docker-compose.root.yml` | Docker Compose config (copy to parent as `docker-compose.yml`) |
| `Caddyfile.root` | Caddy reverse proxy config (copy to parent as `Caddyfile`) |
| `.env.example` | Environment template |
| `dev.sh` | Development script for running services locally without Docker |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM encryption |
| `JWT_SECRET` | Secret for signing JWT tokens (32+ chars) |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |

---

## Troubleshooting

### 401 errors after switching between prod/local

Your browser has a JWT cookie from a different environment. Clear the `keyway_session` cookie for `localhost`.

### Certificate warning

Expected behavior with local HTTPS. Caddy uses self-signed certificates. Click "Advanced" > "Proceed".
