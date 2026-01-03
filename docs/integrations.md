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
| Fly.io | Coming soon |

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
GET /v1/integrations/:provider/authorize
```

Redirects to provider OAuth.

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
