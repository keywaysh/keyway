---
sidebar_position: 6
title: Users
---

# Users API

Get information about the authenticated user and their usage.

## Get current user

Returns the authenticated user's profile.

```http
GET /v1/users/me
Authorization: Bearer <token>
```

**Response:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "octocat",
    "githubId": 12345,
    "avatarUrl": "https://avatars.githubusercontent.com/u/12345",
    "createdAt": "2025-01-01T00:00:00Z"
  }
}
```

---

## Get usage statistics

Returns the user's current usage and limits.

```http
GET /v1/users/me/usage
Authorization: Bearer <token>
```

**Response:**

```json
{
  "data": {
    "vaults": {
      "count": 5,
      "limit": 10
    },
    "secrets": {
      "count": 42,
      "limit": 1000
    },
    "plan": "free"
  }
}
```

### Usage limits by plan

| Plan | Vaults | Secrets per vault |
|------|--------|-------------------|
| Free | 10 | 100 |
| Pro | Unlimited | 1000 |
| Team | Unlimited | Unlimited |

---

## Delete account

Permanently delete your account and all associated data.

```http
DELETE /v1/users/me
Authorization: Bearer <token>
```

**Response (204 No Content)**

:::danger
This action is irreversible. All your vaults and secrets will be permanently deleted.
:::
