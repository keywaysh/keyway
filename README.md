# Keyway Development Environment

Run the full Keyway stack locally with Docker.

## Quick Start

```bash
# Clone and setup
git clone git@github.com:keywaysh/keyway-infra.git keyway
cd keyway
./setup.sh

# Configure .env (see instructions below)
nano .env

# Start
docker compose up --build
```

That's it! Access the dashboard at **https://localhost**

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
| Callback URL | `https://localhost/auth/callback` |
| Webhook | Uncheck "Active" (not needed locally) |
| Permissions | Repository metadata → Read-only |

After creating:
1. Copy **App ID** and **Client ID**
2. Generate a **Client secret**
3. Generate a **Private key** (.pem file)

Convert the private key to a single line:
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

## Usage

```bash
# Start (foreground)
docker compose up --build

# Start (background)
docker compose up -d --build

# View logs
docker compose logs -f backend

# Rebuild one service
docker compose up -d --build site

# Stop
docker compose down

# Full reset (wipes database)
docker compose down -v

# Access database
docker compose exec db psql -U keyway -d keyway
```

---

## Directory Structure

After running `./setup.sh`:

```
keyway/                    ← You are here (keyway-infra repo)
├── docker-compose.yml     ← Docker orchestration
├── Caddyfile              ← HTTPS reverse proxy
├── .env                   ← Your local config (git-ignored)
├── setup.sh               ← Setup script
├── keyway-backend/        ← Cloned repos (git-ignored)
├── keyway-site/
├── keyway-cli/
└── keyway-crypto/
```

Each `keyway-*` folder is an independent Git repo. Changes in those folders are committed to their respective repos, not to `keyway-infra`.

---

## Troubleshooting

### Certificate warning
Expected. Caddy uses self-signed certs. Click "Advanced" → "Proceed".

### 401 errors
Clear the `keyway_session` cookie for localhost.

### Images not loading
```bash
docker compose up -d --build site
```

### Port already in use
```bash
docker compose down
lsof -i :443  # Find what's using the port
```
