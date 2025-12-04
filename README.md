# Keyway API

> GitHub-native secrets manager backend

A simple, secure API for managing team secrets with GitHub authentication and AES-256-GCM encryption.

## Features

- **🔐 Secure**: AES-256-GCM encryption for all secrets
- **👥 GitHub Auth**: OAuth Device Flow + Fine-grained PAT support
- **🗄️ PostgreSQL**: Reliable storage with Drizzle ORM
- **📊 Analytics**: Privacy-first PostHog integration
- **🚀 Production-ready**: Fastify 5, TypeScript, strict validation
- **🔒 Privacy-first**: Metadata-only access, no code reading

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
├── fly.toml             # Fly.io configuration
├── railway.json         # Railway configuration
└── package.json
```

## Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended)
- GitHub OAuth App
- PostHog account (optional, for analytics)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create `.env` from the example:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Database (use Neon connection string)
DATABASE_URL=postgresql://user:password@host/database

# Crypto Service (gRPC encryption service)
CRYPTO_SERVICE_URL=localhost:50051

# JWT Secret for Keyway tokens (min 32 chars)
JWT_SECRET=your-32-character-minimum-secret-here

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# PostHog (optional)
POSTHOG_API_KEY=your_posthog_api_key
POSTHOG_HOST=https://app.posthog.com
```

### 3. Create GitHub OAuth App

1. Go to GitHub Settings → Developer settings → OAuth Apps → New OAuth App
2. Fill in:
   - **Application name**: Keyway
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/auth/github/callback`
3. Save the Client ID and Client Secret

### 4. Start the Crypto Service

The backend requires the `keyway-crypto` gRPC service for encryption. See [keyway-crypto](../keyway-crypto) for setup.

```bash
# In keyway-crypto directory
ENCRYPTION_KEY=$(openssl rand -hex 32) go run .
```

### 5. Run Database Migrations

```bash
# Generate migrations from schema
npm run db:generate

# Run migrations
npm run db:migrate
```

### 6. Start the Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm run build
npm start
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
npm install

# Run in development mode (auto-reload)
npm run dev

# Build for production
npm run build

# Type check
npm run type-check

# Generate database migrations
npm run db:generate

# Run database migrations
npm run db:migrate
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

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with auto-reload |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run type-check` | Run TypeScript type checking |
| `npm run db:generate` | Generate database migrations |
| `npm run db:migrate` | Run database migrations |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `CRYPTO_SERVICE_URL` | Yes | gRPC crypto service address (e.g., localhost:50051) |
| `JWT_SECRET` | Yes | Secret for Keyway JWT tokens (min 32 chars) |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth client secret |
| `POSTHOG_API_KEY` | No | PostHog API key for analytics |
| `POSTHOG_HOST` | No | PostHog host (default: app.posthog.com) |
| `RESEND_API_KEY` | No | Resend API key for welcome emails |

## Troubleshooting

### CLI Token Storage Locations

The CLI stores credentials locally. Useful for debugging auth issues:

**Config file** (via `conf` package):
- macOS: `~/Library/Preferences/keyway-nodejs/config.json`
- Linux: `~/.config/keyway-nodejs/config.json`
- Windows: `%APPDATA%/keyway-nodejs/Config/config.json`

**Encryption key**:
- All platforms: `~/.keyway/.key`

`keyway logout` clears the `auth` key but keeps the encryption key.
For complete cleanup: `rm -rf ~/.keyway ~/Library/Preferences/keyway-nodejs` (macOS)

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

- **Status**: https://status.keyway.sh
- **Issues**: Create an issue on GitHub
- **Documentation**: See [DEPLOYMENT_RAILWAY.md](./DEPLOYMENT_RAILWAY.md) and [POSTHOG_CHECKLIST.md](./POSTHOG_CHECKLIST.md)
