---
sidebar_position: 4
title: Secrets
---

# Secrets API

Manage secrets within vaults. Two APIs are available:

- **REST API** - Individual secret operations (dashboard, integrations)
- **CLI API** - Bulk push/pull operations (CLI, scripts)

---

## REST API

### List secrets

Get all secrets in a vault (metadata only, not decrypted values).

```http
GET /v1/vaults/:owner/:repo/secrets
Authorization: Bearer <token>
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 25 | Max results (1-100) |
| `offset` | number | 0 | Skip N results |

**Response:**

```json
{
  "data": {
    "secrets": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "key": "DATABASE_URL",
        "environment": "production",
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-15T10:30:00Z"
      }
    ],
    "total": 15
  }
}
```

### Create secret

```http
POST /v1/vaults/:owner/:repo/secrets
Authorization: Bearer <token>
Content-Type: application/json

{
  "key": "DATABASE_URL",
  "value": "postgres://user:pass@host:5432/db",
  "environment": "production"
}
```

**Validation:**

- `key`: Uppercase, alphanumeric + underscores, max 256 chars
- `value`: Max 64KB
- `environment`: Must exist in vault's environment list

**Response (201 Created):**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "DATABASE_URL",
    "environment": "production",
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T10:30:00Z"
  }
}
```

### Update secret

```http
PATCH /v1/vaults/:owner/:repo/secrets/:secretId
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "NEW_KEY_NAME",  // optional
  "value": "new_value"     // optional
}
```

At least one of `name` or `value` must be provided.

### Delete secret

```http
DELETE /v1/vaults/:owner/:repo/secrets/:secretId
Authorization: Bearer <token>
```

**Response (204 No Content)**

---

## CLI API

Optimized for bulk operations. Used by the `keyway push` and `keyway pull` commands.

### Push secrets

Push multiple secrets at once. Syncs the entire environment - removes secrets not in the payload.

```http
POST /v1/secrets/push
Authorization: Bearer <token>
Content-Type: application/json

{
  "repoFullName": "owner/repo",
  "environment": "local",
  "secrets": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "sk_test_...",
    "SECRET_TOKEN": "abc123"
  }
}
```

**Limits:**

- Max 1000 secrets per request
- Max 64KB per secret value

**Response:**

```json
{
  "data": {
    "success": true,
    "message": "Secrets pushed successfully",
    "stats": {
      "created": 2,
      "updated": 1,
      "deleted": 0
    }
  }
}
```

### Pull secrets

Pull all secrets for an environment. Returns `.env` format.

```http
GET /v1/secrets/pull?repo=owner/repo&environment=local
Authorization: Bearer <token>
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repo` | string | required | Repository in `owner/repo` format |
| `environment` | string | `default` | Environment name |
| `limit` | number | - | Max secrets to return |
| `offset` | number | - | Skip N secrets |

**Response:**

```json
{
  "data": {
    "content": "DATABASE_URL=postgres://...\nAPI_KEY=sk_test_...\nSECRET_TOKEN=abc123"
  }
}
```

The `content` field contains the secrets in `.env` format, ready to write to a file.
