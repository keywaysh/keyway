---
sidebar_position: 5
title: Environments
---

# Environments API

Each vault has a list of environments (e.g., `local`, `dev`, `staging`, `production`). Secrets are scoped to environments.

## List environments

```http
GET /v1/vaults/:owner/:repo/environments
Authorization: Bearer <token>
```

**Response:**

```json
{
  "data": {
    "environments": ["local", "dev", "staging", "production"]
  }
}
```

New vaults start with default environments: `local`, `dev`, `staging`, `production`.

---

## Create environment

Requires admin access on the repository.

```http
POST /v1/vaults/:owner/:repo/environments
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "preview"
}
```

**Validation:**

- 2-30 characters
- Lowercase letters, numbers, dashes, underscores
- Must start with a letter
- Must not already exist

**Response (201 Created):**

```json
{
  "data": {
    "environment": "preview",
    "environments": ["dev", "local", "preview", "production", "staging"]
  }
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 400 | Invalid environment name |
| 403 | Not an admin on this repository |
| 409 | Environment already exists |

---

## Rename environment

Requires admin access. All secrets in the environment are updated.

```http
PATCH /v1/vaults/:owner/:repo/environments/:name
Authorization: Bearer <token>
Content-Type: application/json

{
  "newName": "development"
}
```

**Response:**

```json
{
  "data": {
    "oldName": "dev",
    "newName": "development",
    "environments": ["development", "local", "production", "staging"]
  }
}
```

---

## Delete environment

Requires admin access. **Deletes all secrets in the environment.**

```http
DELETE /v1/vaults/:owner/:repo/environments/:name
Authorization: Bearer <token>
```

**Response:**

```json
{
  "data": {
    "deleted": "preview",
    "environments": ["dev", "local", "production", "staging"]
  }
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 403 | Cannot delete the last environment |
| 404 | Environment not found |

:::warning
Deleting an environment permanently removes all secrets in that environment.
:::
