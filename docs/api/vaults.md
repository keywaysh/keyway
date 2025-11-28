---
sidebar_position: 3
title: Vaults
---

# Vaults API

Vaults are containers for secrets, linked to GitHub repositories.

## List vaults

Get all vaults you have access to.

```http
GET /v1/vaults
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
    "vaults": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "repoOwner": "acme",
        "repoName": "api",
        "repoAvatar": "https://avatars.githubusercontent.com/...",
        "secretCount": 15,
        "environments": ["local", "dev", "staging", "production"],
        "permission": "admin",
        "updatedAt": "2025-01-15T10:30:00Z"
      }
    ],
    "total": 1
  }
}
```

---

## Create vault

Initialize a vault for a repository. Requires admin access on the GitHub repo.

```http
POST /v1/vaults
Authorization: Bearer <token>
Content-Type: application/json

{
  "repoFullName": "owner/repo"
}
```

**Response (201 Created):**

```json
{
  "data": {
    "vaultId": "550e8400-e29b-41d4-a716-446655440000",
    "repoFullName": "owner/repo",
    "message": "Vault created successfully"
  }
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 403 | Not an admin on this repository |
| 409 | Vault already exists |

---

## Get vault

Get details for a specific vault.

```http
GET /v1/vaults/:owner/:repo
Authorization: Bearer <token>
```

**Response:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "repoFullName": "owner/repo",
    "repoOwner": "owner",
    "repoName": "repo",
    "repoAvatar": "https://avatars.githubusercontent.com/...",
    "secretCount": 15,
    "environments": ["local", "dev", "staging", "production"],
    "permission": "admin",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-15T10:30:00Z"
  }
}
```

---

## Delete vault

Delete a vault and all its secrets. Requires admin access.

```http
DELETE /v1/vaults/:owner/:repo
Authorization: Bearer <token>
```

**Response (204 No Content)**

:::warning
This permanently deletes all secrets in the vault. This action cannot be undone.
:::
