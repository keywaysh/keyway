# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Keyway Backend is a Fastify 5 API for GitHub-native secrets management. It provides vault storage with AES-256-GCM encryption, GitHub OAuth authentication, and integrations with Vercel/Netlify.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Dev server with tsx watch
pnpm run build        # TypeScript compilation
pnpm run type-check   # Type checking only
pnpm run test         # Run tests with Vitest
pnpm run test:watch   # Watch mode
pnpm run db:generate  # Generate Drizzle migrations
pnpm run db:migrate   # Run migrations
pnpm run db:studio    # Open Drizzle Studio
pnpm run validate     # Pre-push: type-check + build
```

## Architecture

### Directory Structure
```
src/
├── index.ts              # Fastify server entry point
├── api/v1/routes/        # API route handlers
│   ├── auth.routes.ts    # OAuth device flow, token validation
│   ├── vaults.routes.ts  # Vault CRUD, environments, secrets
│   ├── secrets.routes.ts # Direct secret operations
│   ├── users.routes.ts   # User profile, usage
│   ├── activity.routes.ts# Audit log
│   ├── admin.routes.ts   # Admin endpoints
│   ├── billing.routes.ts # Stripe integration
│   └── integrations.routes.ts # Provider sync (Vercel, etc.)
├── config/
│   └── plans.ts          # Plan limits (free/pro/team)
├── db/
│   ├── schema.ts         # Drizzle ORM schema
│   └── index.ts          # Database connection
├── errors/               # Custom error classes (RFC 7807)
├── middleware/
│   └── auth.ts           # JWT authentication
├── services/             # Business logic
│   ├── secret.service.ts # Secret CRUD with encryption
│   ├── vault.service.ts  # Vault operations
│   ├── usage.service.ts  # Usage tracking
│   └── ...
├── utils/
│   ├── encryption.ts     # AES-256-GCM encrypt/decrypt
│   ├── github.ts         # GitHub API client
│   ├── response.ts       # Response helpers (sendData, etc.)
│   └── ...
└── types/                # TypeScript types
```

### API Routes

| Route | Description |
|-------|-------------|
| `POST /v1/auth/device/start` | Start device flow |
| `POST /v1/auth/device/poll` | Poll for auth completion |
| `GET /v1/vaults` | List user's vaults |
| `POST /v1/vaults/:owner/:repo` | Create vault |
| `GET /v1/vaults/:owner/:repo/secrets` | List secrets |
| `POST /v1/vaults/:owner/:repo/secrets` | Create/update secret |
| `GET /v1/users/me/usage` | Get plan limits and usage |
| `POST /v1/integrations/vaults/:owner/:repo/sync` | Sync with providers |

### Key Patterns

**Response Format** (RFC 7807 for errors):
```typescript
// Success
sendData(reply, data, { requestId });
// { data: {...}, meta: { requestId } }

// Error
throw new NotFoundError('Vault not found');
// { type, title, status, detail, instance }
```

**Plan Limits** (`src/config/plans.ts`):
```typescript
// Free: 1 private repo, 2 providers, 2 envs, 20 secrets/private vault
// Pro/Team: unlimited
const check = canCreateSecret(user.plan, count, isPrivate);
if (!check.allowed) throw new PlanLimitError(check.reason);
```

**GitHub Permissions**:
```typescript
// Check write access before secret modifications
const role = await getUserRole(token, repo, username);
const canWrite = ['write', 'maintain', 'admin'].includes(role);
```

**Encryption** (via keyway-crypto gRPC service):
```typescript
// AES-256-GCM - key is isolated in keyway-crypto service
const encryptionService = await getEncryptionService();
const encrypted = await encryptionService.encrypt(value);
const decrypted = await encryptionService.decrypt(encrypted);
```

### Database (Drizzle ORM)

Tables: `users`, `vaults`, `secrets`, `device_codes`, `activity_logs`, `provider_connections`, `sync_jobs`, `vault_environments`

```typescript
// Query example
const vault = await db.query.vaults.findFirst({
  where: eq(vaults.repoFullName, `${owner}/${repo}`),
  with: { secrets: true }
});
```

**Creating Migrations**:
When creating a new SQL migration file in `drizzle/`:
1. Create the migration file: `drizzle/00XX_migration_name.sql`
2. **IMPORTANT**: Update `drizzle/meta/_journal.json` to add the new entry:
```json
{
  "idx": XX,
  "version": "5",
  "when": <timestamp>,
  "tag": "00XX_migration_name",
  "breakpoints": true
}
```
3. Run `pnpm run db:migrate` to apply

## Testing

```bash
pnpm test                    # All tests
pnpm test:watch              # Watch mode
pnpm test -- auth.routes     # Specific file
pnpm test:coverage           # Coverage report
```

Tests use Vitest with mocked database (`tests/helpers/mocks.ts`).

## Environment Variables

Required:
- `DATABASE_URL`: PostgreSQL connection string
- `CRYPTO_SERVICE_URL`: keyway-crypto gRPC address
- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`: GitHub App
- `JWT_SECRET`: For signing tokens

Optional:
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: Billing
- `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`: Integration

## Error Handling

Use custom error classes from `src/errors/`:
- `BadRequestError` (400)
- `UnauthorizedError` (401)
- `ForbiddenError` (403)
- `PlanLimitError` (403 with `upgradeUrl`)
- `NotFoundError` (404)
- `ConflictError` (409)
