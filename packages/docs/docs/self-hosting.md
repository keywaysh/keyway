---
sidebar_position: 11
title: Self-Hosting
---

# Self-Hosting

Deploy Keyway on your own infrastructure with Docker Compose. Your encryption keys, your servers, your rules.

## Prerequisites

- **Docker** and **Docker Compose** v2+
- A **domain name** with DNS access (e.g., `example.com`)
- A **GitHub App** (created below)
- Ports **80** and **443** open for HTTPS

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/keywaysh/keyway.git
cd keyway

# 2. Configure
cp .env.example .env
# Edit .env — fill in DOMAIN, ENCRYPTION_KEY, JWT_SECRET, and GitHub App values

# 3. Deploy
docker compose up --build -d
```

Your instance will be available at:
- **Dashboard:** `https://app.your-domain.com`
- **API:** `https://api.your-domain.com`

---

## Step 1: DNS Setup

Create DNS A records pointing to your server:

| Record | Type | Value |
|--------|------|-------|
| `example.com` | A | `<your-server-ip>` |
| `app.example.com` | A | `<your-server-ip>` |
| `api.example.com` | A | `<your-server-ip>` |

Caddy automatically provisions Let's Encrypt TLS certificates for these domains.

## Step 2: Create a GitHub App

Keyway requires a GitHub App for authentication and repository access verification.

1. Go to **https://github.com/settings/apps/new** (or your GitHub Enterprise instance)

2. Fill in the form:

   | Field | Value |
   |-------|-------|
   | **App name** | `keyway` (or any unique name) |
   | **Homepage URL** | `https://example.com` |
   | **Callback URL** | `https://api.example.com/v1/auth/callback` |
   | **Request user authorization during installation** | Checked |
   | **Enable Device Flow** | Checked |
   | **Webhook URL** | `https://api.example.com/v1/github/webhook` (optional) |
   | **Webhook secret** | Generate a random string (optional) |

3. Set permissions:

   | Scope | Permission |
   |-------|------------|
   | **Repository: Metadata** | Read-only |
   | **Repository: Administration** | Read-only |
   | **Account: Email addresses** | Read-only |

4. Subscribe to events (optional, for real-time sync):
   - **Installation**
   - **Installation repositories**

5. After creating, note down:
   - **App ID** (visible on the app settings page)
   - **Client ID**
   - **Client Secret** (generate one)
   - **Private Key** (generate and download the `.pem` file)

6. Base64-encode the private key for the `.env` file:
   ```bash
   cat your-app.private-key.pem | base64 | tr -d '\n'
   ```

## Step 3: Configure Environment

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### Required Variables

```bash
# Your domain
DOMAIN=example.com

# Encryption key (CANNOT be changed after secrets are stored)
ENCRYPTION_KEY=    # openssl rand -hex 32

# JWT secret
JWT_SECRET=        # openssl rand -base64 32

# GitHub App credentials (from Step 2)
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=abc123...
GITHUB_APP_PRIVATE_KEY=base64encodedkey...
GITHUB_APP_NAME=keyway
```

:::tip
`make setup` can auto-generate `ENCRYPTION_KEY` and `JWT_SECRET` for you.
:::

### URL Defaults

All URLs are derived from `DOMAIN` automatically:

| Service | URL |
|---------|-----|
| Dashboard | `https://app.<DOMAIN>` |
| API | `https://api.<DOMAIN>` |

Override individual URLs if needed:
```bash
DASHBOARD_URL=https://custom-dashboard.example.com
ALLOWED_ORIGINS=https://custom-dashboard.example.com
```

## Step 4: Deploy

```bash
docker compose up --build -d
```

This starts all services:

| Service | Description | Port |
|---------|-------------|------|
| **db** | PostgreSQL 16 | 5432 |
| **crypto** | AES-256-GCM encryption gRPC service | 50051 |
| **backend** | Fastify API | 8080 |
| **dashboard** | Next.js dashboard | 3000 |
| **caddy** | Reverse proxy with auto-HTTPS | 80, 443 |

Database migrations run automatically on backend startup.

### Verify the deployment

```bash
# Check all services are healthy
docker compose ps

# Check backend logs
docker compose logs backend

# Test the API
curl https://api.example.com/health
```

## Step 5: Connect the CLI

Install the Keyway CLI and point it at your instance:

```bash
# Install
brew install keywaysh/tap/keyway

# Set your API URL
export KEYWAY_API_URL=https://api.example.com

# Login
keyway login

# Use it
keyway init
keyway push
keyway pull
```

Add `KEYWAY_API_URL` to your shell profile (`~/.bashrc`, `~/.zshrc`) to persist it.

---

## Architecture

```text
                ┌──────────┐
                │  Caddy   │ :80, :443
                │(reverse  │ Auto HTTPS via Let's Encrypt
                │ proxy)   │
                └────┬─────┘
                     │
           ┌─────────┴─────────┐
           │                   │
     ┌─────▼──────┐     ┌─────▼──────┐
     │ Dashboard  │     │  Backend   │
     │ (Next.js)  │     │ (Fastify)  │
     │  :3000     │     │  :8080     │
     └────────────┘     └──┬───┬─────┘
                            │   │
                       ┌────▼┐ ┌▼────────┐
                       │ DB  │ │ Crypto   │
                       │(PG) │ │ (gRPC)   │
                       │:5432│ │ :50051   │
                       └─────┘ └──────────┘
```

- **Caddy** handles TLS termination and reverse proxying
- **Backend** runs database migrations on startup, handles all API logic
- **Crypto** is an isolated gRPC service that holds the encryption key
- **PostgreSQL** stores users, vaults, encrypted secrets, and audit logs

---

## Optional Services

All third-party services are optional. Without them, Keyway works with full core functionality. Leave their env vars empty to disable them.

### Billing (Stripe)

Controls plan limits (free vs pro vs team). **Disabled by default** — all users get unlimited access.

```bash
BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Email (Resend)

Sends welcome emails and security alerts (new device login, impossible travel).

```bash
RESEND_API_KEY=re_...
EMAIL_FROM_ADDRESS=hello@mail.example.com
EMAIL_FROM_NAME=Keyway
```

Without this, no emails are sent. Users can still authenticate and use all features.

### Analytics (PostHog)

Usage metrics. Never tracks secret values.

```bash
# Server-side (backend)
POSTHOG_API_KEY=phc_...
POSTHOG_HOST=https://app.posthog.com

# Client-side (dashboard build args)
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

### Error Tracking (Sentry)

```bash
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
```

### Live Chat (Crisp)

```bash
NEXT_PUBLIC_CRISP_WEBSITE_ID=abc123
```

### IP Geolocation (ipinfo.io)

Enables security features like impossible travel detection and new location alerts.

```bash
IPINFO_TOKEN=abc123
```

### Provider Integrations (Vercel/Netlify)

Enables syncing secrets to deployment platforms.

```bash
VERCEL_CLIENT_ID=...
VERCEL_CLIENT_SECRET=...
NETLIFY_CLIENT_ID=...
NETLIFY_CLIENT_SECRET=...
```

---

## GitHub Enterprise

To use GitHub Enterprise Server instead of GitHub.com:

```bash
GITHUB_URL=https://github.example.com
GITHUB_BASE_URL=https://github.example.com/api/v3
```

The CLI also supports this:
```bash
export KEYWAY_GITHUB_URL=https://github.example.com
export KEYWAY_GITHUB_API_URL=https://github.example.com/api/v3
```

---

## GitHub Action

Use the Keyway GitHub Action in CI workflows with your self-hosted instance:

```yaml
- uses: keywaysh/keyway-action@v1
  with:
    api-url: https://api.example.com
    token: ${{ secrets.KEYWAY_TOKEN }}
```

## MCP Server

The MCP server for AI assistants works with self-hosted instances:

```bash
KEYWAY_API_URL=https://api.example.com npx @keywaysh/mcp
```

---

## Local Development

For local development with `keyway.local` domains and mkcert certificates:

```bash
# Run setup (configures /etc/hosts and generates certs)
make setup

# Use the local Caddyfile
CADDYFILE=./Caddyfile docker compose up --build
```

This gives you:
- `https://app.keyway.local` (dashboard)
- `https://api.keyway.local` (API)

Alternatively, run services directly without Docker:
```bash
make dev              # Starts crypto, backend, and dashboard
make dev-backend      # Backend only
make dev-dashboard    # Dashboard only
```

---

## Upgrading

```bash
git pull
docker compose up --build -d
```

Database migrations run automatically on backend startup.

---

## Troubleshooting

### Backend won't start
Check that the database is healthy and the encryption key is set:
```bash
docker compose logs db
docker compose logs crypto
docker compose logs backend
```

### TLS certificate issues
Caddy needs ports 80 and 443 open for the ACME challenge:
```bash
docker compose logs caddy
```

For local development, use `CADDYFILE=./Caddyfile` with mkcert certificates instead.

### Cookie/logout issues on custom domain
The dashboard derives the cookie domain from the browser hostname. Verify that the API and dashboard share a common parent domain.

### CLI can't connect
Ensure `KEYWAY_API_URL` is set and the API is reachable:
```bash
export KEYWAY_API_URL=https://api.example.com
curl $KEYWAY_API_URL/health
keyway login
```

### GitHub App callback fails
Verify the callback URL in your GitHub App settings matches exactly:
```text
https://api.example.com/v1/auth/callback
```
