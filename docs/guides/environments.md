---
sidebar_position: 2
title: Managing Environments
---

# Managing Environments

Environments let you maintain separate secret configurations for different stages of your development workflow.

## Default environments

Every new vault starts with four environments:

- **local** - For local development
- **dev** - Shared development environment
- **staging** - Pre-production testing
- **production** - Live environment

## Creating environments

### Via API

```bash
curl -X POST https://api.keyway.sh/v1/vaults/owner/repo/environments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "preview"}'
```

### Naming rules

- 2-30 characters
- Lowercase letters, numbers, dashes, underscores
- Must start with a letter

## Environment strategies

### Feature branch environments

Create environments for long-running feature branches via the dashboard or API, then use the CLI:

```bash
# Push feature-specific config
keyway push -e feature-auth

# Pull when working on the feature
keyway pull -e feature-auth
```

### Preview environments

For preview deployments (Vercel, Netlify):

```bash
# Configure preview environment via dashboard, then:
keyway push -e preview
```

### Regional environments

For multi-region deployments, create environments via the dashboard:
- `production-us`
- `production-eu`
- `production-asia`

Then push to each:

```bash
keyway push -e production-us -f .env.us
keyway push -e production-eu -f .env.eu
```

## Copying secrets between environments

Keyway doesn't have a built-in copy command, but you can do it manually:

```bash
# Pull from source
keyway pull -e staging -f .env.temp

# Push to destination
keyway push -e production -f .env.temp

# Clean up
rm .env.temp
```

## Managing environments

Environment management (create, rename, delete) is done via:

- **Dashboard**: Visit your vault at `https://keyway.sh/{owner}/{repo}`
- **API**: Use the environments API endpoints

You can also manage environments programmatically via the API.

## Best practices

### 1. Keep local separate

Use `local` for machine-specific settings that shouldn't be shared:

```
# local environment
DATABASE_URL=postgres://localhost:5432/myapp
REDIS_URL=redis://localhost:6379
```

### 2. Use dev for shared development

The `dev` environment should work for any team member:

```
# dev environment
DATABASE_URL=postgres://dev.example.com:5432/myapp
API_URL=https://api-dev.example.com
```

### 3. Production parity in staging

Keep `staging` as close to `production` as possible:

```
# staging - mirrors production structure
DATABASE_URL=postgres://staging.example.com:5432/myapp
API_URL=https://api-staging.example.com
FEATURE_FLAGS={"newUI": true}
```

### 4. Minimize production secrets locally

Only pull production secrets when absolutely necessary. Prefer working with `dev` or `staging`.
