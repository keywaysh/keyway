# Keyway API

> GitHub-native secrets manager backend

A simple, secure API for managing team secrets with GitHub authentication and AES-256-GCM encryption.

## Features

- **🔐 Secure**: AES-256-GCM encryption for all secrets
- **👥 GitHub OAuth**: Authentication and authorization via GitHub
- **🗄️ PostgreSQL**: Reliable storage with Drizzle ORM
- **📊 Analytics**: Privacy-first PostHog integration
- **🚀 Production-ready**: Fastify server, TypeScript, strict validation

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

# Encryption - Generate with: openssl rand -hex 32
ENCRYPTION_KEY=your-64-character-hex-key-here

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback

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

### 4. Generate Encryption Key

```bash
openssl rand -hex 32
```

Copy the output to `ENCRYPTION_KEY` in `.env`.

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
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Authentication

#### `POST /auth/github/callback`

Exchange GitHub OAuth code for access token.

**Request:**
```json
{
  "code": "github_oauth_code"
}
```

**Response:**
```json
{
  "accessToken": "gho_...",
  "user": {
    "id": 12345,
    "username": "johndoe",
    "email": "john@example.com",
    "avatarUrl": "https://..."
  }
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

### Railway (Recommended)

**See [DEPLOYMENT_RAILWAY.md](./DEPLOYMENT_RAILWAY.md) for detailed instructions.**

Quick steps:

1. Push to GitHub
2. Create new project on Railway.app
3. Add PostgreSQL database
4. Configure environment variables
5. Deploy automatically

### Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch app
fly launch --name keyway-api

# Set secrets
fly secrets set \
  DATABASE_URL="..." \
  ENCRYPTION_KEY="..." \
  GITHUB_CLIENT_ID="..." \
  GITHUB_CLIENT_SECRET="..." \
  POSTHOG_API_KEY="..."

# Deploy
fly deploy
```

## Security

### Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key**: 32-byte symmetric key loaded from environment
- **IV**: Random 16-byte initialization vector per encryption
- **Auth Tag**: 16-byte authentication tag for integrity

### Access Control

- **Authentication**: GitHub OAuth
- **Authorization**: GitHub repository collaborator/admin check
- **Tokens**: GitHub Personal Access Tokens with `repo` scope

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
| `ENCRYPTION_KEY` | Yes | 32-byte hex encryption key |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth client secret |
| `GITHUB_REDIRECT_URI` | Yes | OAuth callback URL |
| `POSTHOG_API_KEY` | No | PostHog API key for analytics |
| `POSTHOG_HOST` | No | PostHog host (default: app.posthog.com) |

## Troubleshooting

### "DATABASE_URL is not defined"

Make sure you've created a `.env` file with your database connection string.

### "ENCRYPTION_KEY must be 32 bytes"

Generate a proper key:
```bash
openssl rand -hex 32
```

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

- **Issues**: Create an issue on GitHub
- **Documentation**: See [DEPLOYMENT_RAILWAY.md](./DEPLOYMENT_RAILWAY.md) and [POSTHOG_CHECKLIST.md](./POSTHOG_CHECKLIST.md)
