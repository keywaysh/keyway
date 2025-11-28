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

### Via CLI

```bash
keyway env create preview
```

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

Create environments for long-running feature branches:

```bash
# Create environment for feature
keyway env create feature-auth

# Push feature-specific config
keyway push --env feature-auth

# Clean up when done
keyway env delete feature-auth
```

### Preview environments

For preview deployments (Vercel, Netlify):

```bash
# Create a preview environment
keyway env create preview

# Configure with preview-specific values
keyway push --env preview
```

### Regional environments

For multi-region deployments:

```bash
keyway env create production-us
keyway env create production-eu
keyway env create production-asia
```

## Copying secrets between environments

Keyway doesn't have a built-in copy command, but you can do it manually:

```bash
# Pull from source
keyway pull --env staging --output .env.temp

# Push to destination
keyway push --env production --file .env.temp

# Clean up
rm .env.temp
```

## Renaming environments

Rename an environment while preserving all its secrets:

```bash
keyway env rename dev development
```

All secrets are automatically updated to the new environment name.

## Deleting environments

:::warning
Deleting an environment permanently removes all secrets in that environment.
:::

```bash
keyway env delete preview
```

You cannot delete the last remaining environment in a vault.

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
