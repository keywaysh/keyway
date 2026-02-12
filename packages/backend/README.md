# Keyway API

[![CI](https://github.com/keywaysh/keyway-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/keywaysh/keyway-backend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-green.svg)](https://nodejs.org/)
[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=keywaysh/keyway-backend)](https://www.keyway.sh/vaults/keywaysh/keyway-backend)

**The API behind [Keyway](https://keyway.sh)** — GitHub-native secrets management.

## Architecture

```
┌─────────┐       ┌─────────────┐       ┌──────────────┐
│   CLI   │──────▶│  Keyway API │◀─────▶│   Postgres   │
└─────────┘       └──────┬──────┘       └──────────────┘
                         │
            ┌────────────┼────────────┐
            ▼                         ▼
   ┌─────────────────┐      ┌─────────────────┐
   │   GitHub API    │      │  keyway-crypto  │
   │  (permissions)  │      │  (Go + gRPC)    │
   └─────────────────┘      └─────────────────┘
```

- **Keyway API** — Fastify 5, TypeScript, handles auth and vault operations
- **keyway-crypto** — Go microservice, AES-256-GCM encryption, holds the encryption key
- **GitHub API** — Verifies repo access (collaborator check)
- **Postgres** — Stores encrypted secrets, user data, audit logs

## Features

- **Encrypted at rest** — AES-256-GCM with random IV per secret, key isolated in Go service
- **GitHub auth** — OAuth Device Flow or fine-grained PAT, no new credentials to manage
- **Permission-based** — If you have repo access, you get secret access. That's it.
- **CI-ready** — GitHub Action for injecting secrets into workflows

## Project Structure

```
keyway-backend/
├── src/
│   ├── db/              # Database schema and migrations
│   │   ├── schema.ts    # Drizzle schema (users, vaults, secrets)
│   │   ├── index.ts     # Database connection
│   │   └── migrate.ts   # Migration runner
│   ├── routes/          # API endpoints
│   │   ├── auth.ts      # GitHub OAuth callback
│   │   └── vaults.ts    # Vault operations (init, push, pull)
│   ├── utils/           # Utilities
│   │   ├── encryption.ts # AES-256-GCM encryption
│   │   ├── github.ts     # GitHub API client
│   │   └── analytics.ts  # PostHog integration
│   ├── types/           # TypeScript types and Zod schemas
│   │   └── index.ts
│   └── index.ts         # Fastify server entry point
├── drizzle/             # Generated migrations
├── Dockerfile           # Production Docker image
├── railway.json         # Railway configuration
└── package.json
```

## Prerequisites

- Node.js 22+
- PostgreSQL (Neon recommended)
- GitHub App
- [keyway-crypto](../keyway-crypto) service running

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment Variables

Create `.env` from the example:

```bash
cp .env.example .env
```

Edit `.env` with the required variables:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@host/database

# Crypto Service (keyway-crypto gRPC address)
CRYPTO_SERVICE_URL=localhost:50051

# JWT Secret (min 32 chars)
JWT_SECRET=your-32-character-minimum-secret-here

# GitHub App (not OAuth App)
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_APP_PRIVATE_KEY=<base64-encoded .pem file>
GITHUB_APP_WEBHOOK_SECRET=<optional in dev, required in prod>
GITHUB_APP_NAME=keyway

# PostHog (optional)
POSTHOG_API_KEY=
POSTHOG_HOST=https://app.posthog.com
```

### 3. Create GitHub App

1. Go to [GitHub Settings → Developer settings → GitHub Apps → New GitHub App](https://github.com/settings/apps/new)
2. Configure:
   - **GitHub App name**: `keyway` (or your app name)
   - **Homepage URL**: `https://keyway.sh`
   - **Callback URL**: `http://localhost:3000/v1/auth/callback`
   - **Enable Device Flow**: ✓
   - **Webhook URL**: `http://localhost:3000/v1/webhooks/github` (or disable in dev)
3. Permissions:
   - **Repository → Metadata**: Read-only
   - **Repository → Administration**: Read-only
   - **Account → Email addresses**: Read-only
4. Save the App ID, Client ID, Client Secret, and generate a Private Key

### 4. Start the Crypto Service

The backend requires the `keyway-crypto` gRPC service for encryption. See [keyway-crypto](../keyway-crypto) for setup.

```bash
# In keyway-crypto directory
ENCRYPTION_KEY=$(openssl rand -hex 32) go run .
```

### 5. Run Database Migrations

```bash
# Generate migrations from schema
pnpm run db:generate

# Run migrations
pnpm run db:migrate
```

### 6. Start the Server

```bash
# Development mode (with auto-reload)
pnpm run dev

# Production mode
pnpm run build
pnpm start
```

The API will be available at `http://localhost:3000`.

## API Endpoints

### Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "production",
  "database": "connected",
  "crypto": "connected",
  "cryptoVersion": "1.0.0"
}
```

Returns 503 if database is disconnected. Crypto service status is included but doesn't affect overall health status.

### Authentication

#### OAuth Device Flow

**POST /auth/device/start** - Start device authorization

Request:
```json
{
  "repository": "owner/repo"  // optional, suggested repo from CLI
}
```

Response:
```json
{
  "deviceCode": "abc123...",
  "userCode": "ABCD-1234",
  "verificationUri": "https://your-api.com/auth/device/verify",
  "verificationUriComplete": "https://your-api.com/auth/device/verify?user_code=ABCD-1234",
  "expiresIn": 900,
  "interval": 5
}
```

**POST /auth/device/poll** - Poll for authorization status

Request:
```json
{
  "deviceCode": "abc123..."
}
```

Response (approved):
```json
{
  "status": "approved",
  "keywayToken": "eyJhbGc...",
  "githubLogin": "johndoe",
  "expiresAt": "2025-02-23T..."
}
```

#### Fine-grained PAT

**POST /auth/token/validate** - Validate Personal Access Token

Headers:
```
Authorization: Bearer github_pat_...
```

Response:
```json
{
  "username": "johndoe",
  "githubId": 12345
}
```

### Vaults

#### `POST /vaults/init`

Initialize a new vault for a repository.

**Request:**
```json
{
  "repoFullName": "owner/repo",
  "accessToken": "gho_..."
}
```

**Response:**
```json
{
  "vaultId": "uuid",
  "repoFullName": "owner/repo",
  "message": "Vault initialized successfully"
}
```

#### `POST /vaults/:repo/:env/push`

Push secrets to a vault environment.

**Request:**
```json
{
  "content": "API_KEY=abc123\nDB_URL=postgres://...",
  "accessToken": "gho_..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Secrets pushed successfully"
}
```

#### `GET /vaults/:repo/:env/pull?accessToken=...`

Pull secrets from a vault environment.

**Response:**
```json
{
  "content": "API_KEY=abc123\nDB_URL=postgres://..."
}
```

### Environments

Each vault has a list of allowed environments. Secrets can only be pushed to environments that exist in the vault.

#### `GET /v1/vaults/:owner/:repo/environments`

Get the list of environments for a vault.

**Response:**
```json
{
  "data": {
    "environments": ["local", "dev", "staging", "production"]
  }
}
```

#### `POST /v1/vaults/:owner/:repo/environments` (Admin only)

Create a new environment.

**Request:**
```json
{
  "name": "preview"
}
```

**Response:**
```json
{
  "data": {
    "environment": "preview",
    "environments": ["local", "dev", "staging", "production", "preview"]
  }
}
```

**Validation:**
- Name must be 2-30 characters
- Lowercase letters, numbers, dashes, and underscores only
- Must start with a letter

#### `PATCH /v1/vaults/:owner/:repo/environments/:name` (Admin only)

Rename an environment. All secrets in that environment are updated.

**Request:**
```json
{
  "newName": "development"
}
```

**Response:**
```json
{
  "data": {
    "oldName": "dev",
    "newName": "development",
    "environments": ["local", "development", "staging", "production"]
  }
}
```

#### `DELETE /v1/vaults/:owner/:repo/environments/:name` (Admin only)

Delete an environment and all its secrets.

**Response:**
```json
{
  "data": {
    "deleted": "preview",
    "environments": ["local", "dev", "staging", "production"]
  }
}
```

**Note:** Cannot delete the last environment in a vault.

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode (auto-reload)
pnpm dev

# Build for production
pnpm build

# Type check
pnpm run type-check

# Generate database migrations
pnpm run db:generate

# Run database migrations
pnpm run db:migrate
```

## Deployment

### Railway

**See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment guide.**

Quick steps:

1. Create GitHub OAuth App
2. Push code to GitHub
3. Create new project on Railway.app
4. Add PostgreSQL database
5. Configure environment variables (see below)
6. Railway auto-deploys on push to main

**Always run before pushing:**
```bash
pnpm run validate  # Type check + build + env validation
```

Railway will automatically:
- Run migrations (`pnpm run db:migrate`)
- Build the app (`pnpm build`)
- Start the server (`node dist/index.js`)
- Health check on `/health`
- Rollback if deployment fails

## Security

### Encryption

- **Service**: Dedicated `keyway-crypto` gRPC microservice
- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key**: 32-byte symmetric key stored only in crypto service
- **IV**: Random 12-byte initialization vector per encryption
- **Auth Tag**: 16-byte authentication tag for integrity
- **Isolation**: Encryption key never leaves the crypto service

### Access Control

- **Authentication**: OAuth Device Flow or Fine-grained PAT
- **Authorization**: GitHub repository collaborator/admin check via API
- **Tokens**:
  - OAuth tokens (30-day Keyway JWT + GitHub access token)
  - Fine-grained PATs (user-controlled scope and expiration)
- **Privacy**: Only metadata access, never reads repository code

### Logging

- **No secret values** are ever logged
- All content is sanitized before logging (`sanitizeForLogging`)
- Only metadata (line count, character count) is logged

### Analytics Safety

**NEVER tracked:**
- Secret names or values
- Environment variable content
- Access tokens
- Encryption keys

**Only tracked:**
- Repository names (public info)
- Environment names (e.g., "production")
- Command usage (init, push, pull)
- Error messages (sanitized)

See [POSTHOG_CHECKLIST.md](./POSTHOG_CHECKLIST.md) for details.

## Database Schema

### Users Table

```typescript
{
  id: uuid (PK)
  githubId: number (unique)
  username: string
  email: string?
  avatarUrl: string?
  accessToken: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

### Vaults Table

```typescript
{
  id: uuid (PK)
  repoFullName: string (unique)
  environments: string[] (default: ['local', 'dev', 'staging', 'production'])
  ownerId: uuid (FK → users)
  createdAt: timestamp
  updatedAt: timestamp
}
```

### Secrets Table

```typescript
{
  id: uuid (PK)
  vaultId: uuid (FK → vaults, cascade delete)
  environment: string
  encryptedContent: string
  iv: string
  authTag: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

## Troubleshooting

### "DATABASE_URL is not defined"

Make sure you've created a `.env` file with your database connection string.

### "Crypto service unavailable"

Make sure the `keyway-crypto` gRPC service is running:
```bash
cd ../keyway-crypto
ENCRYPTION_KEY=$(openssl rand -hex 32) go run .
```

And that `CRYPTO_SERVICE_URL` points to it (default: `localhost:50051`).

### Migration errors

If migrations fail, check:
1. Database is accessible
2. DATABASE_URL is correct
3. Database user has CREATE TABLE permissions

### Port already in use

Change the port in `.env`:
```env
PORT=3001
```

## License

MIT

## Support

- **Docs**: https://docs.keyway.sh
- **CLI**: https://github.com/keywaysh/cli
- **MCP Server**: https://github.com/keywaysh/keyway-mcp
- **Status**: https://status.keyway.sh
- **Issues**: [GitHub Issues](https://github.com/keywaysh/keyway-backend/issues)
