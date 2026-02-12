---
sidebar_position: 8
title: Security
---

# Security & Permissions

## Encryption

| Layer | Method |
|-------|--------|
| At rest | AES-256-GCM (random IV per encryption) |
| In transit | TLS 1.3, HSTS |

---

## Runtime Security (Zero-Trust)

Keyway promotes a "Zero-Trust" approach where secrets should not persist on disk in unencrypted form.

### Runtime Injection

Using `keyway run`, secrets are:
1. Fetched from the vault via TLS 1.3
2. Decrypted in memory (RAM)
3. Injected directly into the child process environment
4. **Never written to disk** (no `.env` file created)

This mitigates risks associated with:
- Accidental commits of `.env` files
- Backup software archiving unencrypted secrets
- Malware scanning the filesystem for credential patterns
- Residual data on disk after deletion

```bash
# Example: Inject secrets directly into memory
keyway run -- npm start
```

---

## Default Permissions

GitHub repo access = Keyway vault access. No separate user management.

### Personal Repos

| Role | Read | Write | Admin |
|------|:----:|:-----:|:-----:|
| Owner | ✓ | ✓ | ✓ |
| Collaborator | ✓ | ✓ | - |

### Organization Repos

| Role | Read | Write | Admin |
|------|:----:|:-----:|:-----:|
| Admin | ✓ | ✓ | ✓ |
| Maintain | ✓ | ✓ | - |
| Write | ✓ | ✓ | - |
| Triage | ✓ | - | - |
| Read | ✓ | - | - |

### Environment-Based Defaults

Keyway applies stricter defaults for production environments:

| Environment Type | Examples | Write Access |
|------------------|----------|--------------|
| Protected | `production`, `prod`, `main` | `admin` only |
| Standard | `staging`, `test`, `qa` | `write`+ roles |
| Development | `local`, `dev`, `development` | `write`+ roles |

---

## Permission Overrides

Organization owners and repo admins can customize permissions per environment.

### Why Use Overrides?

- Restrict production writes to specific users
- Grant read-only access to certain roles
- Lock down sensitive environments

### Creating an Override

```http
POST /v1/vaults/:owner/:repo/permissions/overrides
{
  "environment": "production",
  "targetType": "role",
  "targetRole": "write",
  "canRead": true,
  "canWrite": false
}
```

This prevents users with `write` role from pushing to production.

### Override Types

| Type | Target | Example |
|------|--------|---------|
| `role` | All users with a specific GitHub role | All `write` users |
| `user` | Specific Keyway user | One team member |

### User-Specific Override

```http
POST /v1/vaults/:owner/:repo/permissions/overrides
{
  "environment": "production",
  "targetType": "user",
  "targetUserId": "uuid-of-user",
  "canRead": true,
  "canWrite": true
}
```

### Listing Overrides

```http
GET /v1/vaults/:owner/:repo/permissions/overrides
```

Returns:
```json
{
  "data": {
    "overrides": [
      {
        "id": "uuid",
        "environment": "production",
        "targetType": "role",
        "targetRole": "write",
        "canRead": true,
        "canWrite": false,
        "createdBy": "user-uuid",
        "createdAt": "2025-01-01T00:00:00Z"
      }
    ],
    "defaults": {
      "read": { "read": true, "write": false },
      "write": { "read": true, "write": true }
    }
  }
}
```

### Checking Effective Permissions

```http
GET /v1/vaults/:owner/:repo/permissions/effective
```

Returns your actual permissions after overrides are applied:

```json
{
  "data": {
    "role": "write",
    "permissions": {
      "local": { "canRead": true, "canWrite": true },
      "staging": { "canRead": true, "canWrite": true },
      "production": { "canRead": true, "canWrite": false }
    }
  }
}
```

### Resetting Overrides

Remove all custom permissions:

```http
DELETE /v1/vaults/:owner/:repo/permissions/reset
```

---

## Activity Logs

Keyway logs all secret access and modifications.

### Viewing Your Activity

```http
GET /v1/activity?limit=50&offset=0
```

Returns:
```json
{
  "data": [
    {
      "id": "uuid",
      "action": "secrets_pulled",
      "platform": "cli",
      "metadata": {
        "repoFullName": "owner/repo",
        "environment": "local",
        "secretCount": 5
      },
      "ip": "192.168.1.1",
      "userAgent": "keyway-cli/1.0.0",
      "createdAt": "2025-01-01T12:00:00Z"
    }
  ]
}
```

### Tracked Actions

| Action | Description |
|--------|-------------|
| `login` | User authenticated |
| `secrets_pulled` | Secrets downloaded |
| `secrets_pushed` | Secrets uploaded |
| `secret_value_accessed` | Single secret viewed |
| `secret_created` | New secret added |
| `secret_updated` | Secret modified |
| `secret_deleted` | Secret removed |
| `vault_created` | Vault initialized |
| `vault_deleted` | Vault removed |
| `api_key_created` | API key generated |
| `api_key_revoked` | API key revoked |
| `integration_connected` | Provider linked |
| `integration_synced` | Secrets synced to provider |

### Retention

| Plan | Retention |
|------|-----------|
| Free | 7 days |
| Team | 90 days |

---

## Security Alerts

Keyway detects suspicious activity and generates alerts.

### Viewing Alerts

```http
GET /v1/vaults/:owner/:repo/security/alerts
```

### Alert Types

| Type | Trigger |
|------|---------|
| `new_device` | First pull from unknown device/IP |
| `unusual_location` | Access from unexpected geographic location |
| `high_frequency` | Unusual number of pulls in short time |
| `after_hours` | Access outside normal patterns |

### Alert Response

Alerts include:
- Device fingerprint
- IP address
- User agent
- Timestamp
- Severity level

:::caution
Security alerts are informational. Investigate any unexpected alerts and rotate secrets if necessary.
:::

---

## Authentication

### OAuth Device Flow (CLI)

1. CLI requests device code
2. User approves in browser
3. CLI receives token (30 days)

Token stored in `~/.config/keyway-nodejs/config.json` (Linux) or `~/Library/Preferences/keyway-nodejs/config.json` (macOS), mode 600.

### API Keys (Recommended for CI/CD)

API keys are the recommended authentication method for CI/CD:

```http
POST /v1/api-keys
{
  "name": "GitHub Actions Prod",
  "environment": "live",
  "scopes": ["read:secrets"],
  "expiresInDays": 365
}
```

Benefits over PATs:
- Scoped permissions (read-only possible)
- Keyway-specific (doesn't grant GitHub access)
- Revocable without affecting GitHub tokens
- Expiration dates
- IP restrictions (optional)

See [API Reference](./api#api-keys) for details.

### GitHub PAT (Legacy)

Fine-grained PATs still work but API keys are preferred.

Use [fine-grained PATs](https://github.com/settings/tokens?type=beta) with `Contents: Read`.

---

## Team Management

**Add access:** Add user as GitHub collaborator -> they run `keyway pull`

**Remove access:** Remove from GitHub repo -> instant revocation

**Check access:**
```bash
keyway doctor
```

---

## Best Practices

1. **Use API keys for CI/CD** - More secure than PATs
2. **Never commit secrets** - `.gitignore` all `.env` files
3. **Least privilege** - Use `read:secrets` scope when possible
4. **Rotate regularly** - Especially after team changes
5. **Separate environments** - Don't use production secrets locally
6. **Set expiration dates** - API keys should expire within 1 year
7. **Monitor activity logs** - Review access patterns periodically
8. **Use Runtime Injection** - Use `keyway run` to avoid storing secrets on disk

---

## Incident Response

### Compromised Secret

1. Rotate immediately at the source (database, API provider, etc.)
2. `keyway push` new values
3. Deploy changes to all environments
4. Review activity logs for unauthorized access

### Compromised API Key

1. Revoke the key immediately:
   ```http
   DELETE /v1/api-keys/:id
   ```
2. Create a new key with appropriate scopes
3. Update CI/CD secrets
4. Review activity logs

### Compromised CLI Token

1. `keyway logout` or revoke from dashboard
2. Re-authenticate with `keyway login`
3. Review recent activity

---

## Reporting Vulnerabilities

Email security@keyway.sh with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We respond within 24 hours and follow responsible disclosure practices.