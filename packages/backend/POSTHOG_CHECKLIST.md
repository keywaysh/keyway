# PostHog Analytics Checklist

## Overview

Keyway uses PostHog for privacy-first analytics to understand how the product is being used and identify issues.

**CRITICAL RULE**: Never track secret names, values, or any sensitive data.

## Events Tracked

### API Events

| Event | Properties | Description |
|-------|-----------|-------------|
| `api_vault_initialized` | `repoFullName`, `username`, `isNewUser` | When a vault is created for a repository |
| `api_secrets_pushed` | `repoFullName`, `environment` | When secrets are pushed to a vault |
| `api_secrets_pulled` | `repoFullName`, `environment` | When secrets are pulled from a vault |
| `api_auth_success` | `username`, `isNewUser` | Successful GitHub authentication |
| `api_auth_failure` | `error` (sanitized) | Failed GitHub authentication |
| `api_error` | `endpoint`, `error` (sanitized) | API errors |

### CLI Events

| Event | Properties | Description |
|-------|-----------|-------------|
| `cli_init` | `repoFullName` | CLI vault initialization |
| `cli_push` | `repoFullName`, `environment`, `variableCount` | CLI secrets push |
| `cli_pull` | `repoFullName`, `environment` | CLI secrets pull |
| `cli_error` | `command`, `error` (sanitized) | CLI errors |

## Distinct IDs

### API
- User UUID from database
- Anonymous for unauthenticated requests

### CLI
- Machine-specific UUID stored in `~/.config/keyway/id.json`
- Generated once per machine
- Anonymous and persistent

## Safety Rules

### ✅ ALLOWED Properties

- `repoFullName` - Public repository information
- `environment` - Environment name (e.g., "production", "development")
- `username` - GitHub username (public information)
- `variableCount` - Number of environment variables (no names/values)
- `command` - CLI command name
- `endpoint` - API endpoint path
- `error` - Error message (after sanitization)
- `platform` - OS platform
- `nodeVersion` - Node.js version
- `source` - "api" or "cli"
- `isNewUser` - Boolean flag

### ❌ FORBIDDEN Properties

**NEVER track these:**

- Secret names (e.g., `API_KEY`, `DATABASE_URL`)
- Secret values (e.g., `abc123`, connection strings)
- Environment variable content
- Access tokens (GitHub tokens, OAuth tokens)
- Encryption keys
- File contents
- Email addresses
- IP addresses (beyond what PostHog automatically collects)

### Sanitization Functions

Both API and CLI have `sanitizeProperties()` functions that automatically remove forbidden fields.

**API**: `api/src/utils/analytics.ts`
```typescript
function sanitizeProperties(properties: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    // Never include these sensitive fields
    if (
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('content') ||
      key.toLowerCase().includes('key')
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
```

**CLI**: `cli/src/utils/analytics.ts`
```typescript
function sanitizeProperties(properties: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    // Never include these sensitive fields
    if (
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('content') ||
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('value')
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
```

## Implementation Checklist

### API

- [x] PostHog client initialized in `api/src/utils/analytics.ts`
- [x] `trackEvent()` function with automatic sanitization
- [x] All events use distinct user IDs (never expose PII)
- [x] Graceful shutdown on server exit
- [x] Events tracked in all route handlers
- [x] No secret values in any event properties
- [x] Error messages sanitized before tracking

### CLI

- [x] PostHog client lazy-loaded (performance optimization)
- [x] Machine-specific distinct ID stored in `~/.config/keyway/id.json`
- [x] `trackEvent()` function with automatic sanitization
- [x] Events tracked in all commands (init, push, pull)
- [x] Error events tracked with sanitized error messages
- [x] Graceful analytics shutdown on CLI exit
- [x] No secret names or values in any event properties
- [x] Silent failures (analytics never breaks the CLI)

## Testing Analytics

### Manual Testing

1. **Set PostHog API Key**:
   ```bash
   export POSTHOG_API_KEY=your_test_key
   ```

2. **Run Commands**:
   ```bash
   keyway init
   keyway push
   keyway pull
   ```

3. **Check PostHog Dashboard**:
   - Verify events appear with correct names
   - Check that properties are safe (no secrets)
   - Verify distinct IDs are anonymous

### What to Look For

✅ **Good Event Example**:
```json
{
  "event": "cli_push",
  "distinctId": "a7f3c8d9-1234-5678-90ab-cdef12345678",
  "properties": {
    "repoFullName": "acme/api",
    "environment": "production",
    "variableCount": 15,
    "source": "cli",
    "platform": "darwin",
    "nodeVersion": "v20.10.0"
  }
}
```

❌ **Bad Event Example** (would be blocked by sanitization):
```json
{
  "event": "cli_push",
  "properties": {
    "API_KEY": "abc123",           // ❌ Secret name and value
    "secretContent": "...",         // ❌ Secret content
    "githubToken": "gho_...",       // ❌ Access token
    "encryptionKey": "..."          // ❌ Encryption key
  }
}
```

## Compliance

- **GDPR**: Users are anonymous (no PII beyond GitHub username)
- **Privacy**: No sensitive data tracked
- **Opt-out**: Users can disable analytics by not setting `POSTHOG_API_KEY`

## Monitoring

### Key Metrics to Track

1. **Usage**:
   - Daily/weekly active users (distinct IDs)
   - Commands per user
   - Most used environments

2. **Errors**:
   - Error rates by command
   - Common error types
   - API vs CLI errors

3. **Adoption**:
   - New vault initializations
   - Repositories using Keyway
   - Push/pull frequency

### Alerts to Set Up

- Spike in error events
- Drop in daily active users
- High error rate for specific commands

## Resources

- [PostHog Documentation](https://posthog.com/docs)
- [PostHog Node SDK](https://posthog.com/docs/libraries/node)
- [GDPR Compliance](https://posthog.com/docs/privacy/gdpr-compliance)
