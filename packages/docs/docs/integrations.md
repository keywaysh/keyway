---
sidebar_position: 10
title: Integrations
---

# Provider Integrations

Sync secrets with Vercel, Netlify, and Railway.

## Supported Providers

| Provider | Status |
|----------|--------|
| Vercel | Available |
| Netlify | Available |
| Railway | Available |

---

## CLI Workflow

### Connect

```bash
keyway connect vercel   # Opens browser for OAuth
```

### List Connections

```bash
keyway connections
```

### Sync Secrets

```bash
keyway sync vercel                              # Push production → Vercel
keyway sync vercel -e staging --provider-env preview
keyway sync vercel --pull                       # Import from Vercel
keyway sync vercel --allow-delete -y            # Full sync (deletes too)
```

### Disconnect

```bash
keyway disconnect vercel
```

---

## API Endpoints

### List Connections

```http
GET /v1/integrations/connections
```

### Connect Provider

```http
POST /v1/integrations/:provider/authorize-ticket
Authorization: Bearer <token>
```

Returns `{ url, expiresIn }`. Open `url` in the browser that will complete the provider OAuth: it carries a single-use ticket valid for 10 minutes, never your token. The flow only starts in a browser signed in to Keyway as the same user (you are sent through the GitHub sign-in first if needed).

```http
GET /v1/integrations/:provider/authorize?ticket=...
```

Redirects to provider OAuth. The flow is bound to the browser that opened it, so the callback must complete in that same browser.

### List Projects

```http
GET /v1/integrations/connections/:id/projects
```

### Preview Sync

```http
GET /v1/integrations/vaults/:owner/:repo/sync/preview
  ?connectionId=...&projectId=...&direction=push
```

Returns `toCreate`, `toUpdate`, `toDelete`, `toSkip`.

### Execute Sync

```http
POST /v1/integrations/vaults/:owner/:repo/sync
{
  "connectionId": "...",
  "projectId": "...",
  "keywayEnvironment": "production",
  "providerEnvironment": "production",
  "direction": "push",
  "allowDelete": false
}
```

### Delete Connection

```http
DELETE /v1/integrations/connections/:id
```

---

## Environment Mapping

| Keyway | Vercel | Netlify | Railway |
|--------|--------|---------|---------|
| `production` | `production` | `production` | `production` |
| `staging` | `preview` | `deploy-preview` | `staging` |
| `development` | `development` | `local` | `development` |
| `dev` | `development` | `local` | `development` |

Override with `--provider-env`:

```bash
keyway sync vercel -e staging --provider-env preview
```

---

## Common Workflows

### Initial Setup

```bash
keyway connect vercel
keyway sync vercel --pull    # Import existing Vercel secrets
keyway push                   # Push to Keyway
```

### Deploy Pipeline

```bash
# Before deploy: sync Keyway → Vercel
keyway sync vercel -e production -y
```

### Keep in Sync

```bash
# After updating secrets in Keyway
keyway sync vercel -e production
```

---

## Best Practices

1. **Start with pull** - Import existing provider secrets before pushing
2. **Use `--allow-delete` carefully** - Preview first
3. **Map environments explicitly** - Use `--provider-env` to avoid mistakes
4. **Keyway as source of truth** - Push from Keyway, don't edit in provider UI
