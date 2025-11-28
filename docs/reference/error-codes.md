---
sidebar_position: 2
title: Error Codes
---

# Error Codes Reference

Complete reference for Keyway API and CLI error codes.

## HTTP Status Codes

### 400 Bad Request

**Type:** `bad-request`

The request body or parameters are invalid.

**Common causes:**
- Invalid JSON in request body
- Missing required fields
- Invalid field values

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid environment name: must start with a letter",
  "instance": "/v1/vaults/owner/repo/environments"
}
```

**Resolution:** Check your request body matches the API specification.

---

### 401 Unauthorized

**Type:** `unauthorized`

Authentication is missing or invalid.

**Common causes:**
- Missing `Authorization` header
- Expired token
- Malformed token

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid or expired token"
}
```

**Resolution:**
- Ensure you include `Authorization: Bearer <token>`
- Re-authenticate with `keyway login`
- Generate a new PAT if using GitHub tokens

---

### 403 Forbidden

**Type:** `forbidden`

You don't have permission for this operation.

**Common causes:**
- Insufficient repository access level
- Trying admin operations without admin access
- Repository access revoked

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Admin access required to delete environments"
}
```

**Resolution:**
- Check your access level on the GitHub repository
- Contact a repository admin for elevated access
- Verify you're accessing the correct repository

---

### 404 Not Found

**Type:** `not-found`

The requested resource doesn't exist.

**Common causes:**
- Vault not initialized
- Environment doesn't exist
- Secret doesn't exist
- Typo in repository name

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Vault not found for repository owner/repo"
}
```

**Resolution:**
- Initialize the vault with `keyway init`
- Verify the repository name is correct
- Check the environment/secret exists

---

### 409 Conflict

**Type:** `conflict`

The resource already exists or conflicts with existing state.

**Common causes:**
- Vault already exists for repository
- Environment name already taken
- Secret key already exists in environment

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Environment 'staging' already exists"
}
```

**Resolution:**
- Use a different name
- Update the existing resource instead of creating

---

### 422 Unprocessable Entity

**Type:** `validation-error`

The request is well-formed but contains invalid data.

**Common causes:**
- Secret key doesn't match naming rules
- Environment name too long
- Secret value exceeds size limit

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Secret key must be uppercase alphanumeric with underscores",
  "errors": [
    {
      "field": "key",
      "message": "Must match pattern ^[A-Z][A-Z0-9_]*$"
    }
  ]
}
```

**Resolution:** Fix the validation errors listed in the response.

---

### 429 Too Many Requests

**Type:** `rate-limited`

You've exceeded the rate limit.

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded. Try again in 60 seconds"
}
```

**Headers:**
- `Retry-After: 60` - Seconds until you can retry

**Resolution:**
- Wait for the `Retry-After` period
- Implement exponential backoff in scripts
- Reduce request frequency

---

### 500 Internal Server Error

**Type:** `internal-error`

An unexpected error occurred on the server.

**Example response:**

```json
{
  "type": "https://keyway.sh/errors/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Resolution:**
- Retry the request
- If persistent, contact support with the `requestId`

---

## CLI Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | Success | Operation completed successfully |
| 1 | General Error | Unspecified error |
| 2 | Auth Required | Not logged in or token expired |
| 3 | Vault Not Found | No vault for this repository |
| 4 | Permission Denied | Insufficient access level |
| 5 | Network Error | Cannot reach Keyway API |
| 6 | Git Error | Not a git repository or no remote |
| 7 | File Error | Cannot read/write local files |

---

## Validation Errors

### Secret key validation

Valid: `DATABASE_URL`, `API_KEY_V2`, `SECRET123`

Invalid:
- `database_url` - Must be uppercase
- `123_KEY` - Must start with letter
- `API-KEY` - No dashes allowed

Pattern: `^[A-Z][A-Z0-9_]{0,255}$`

### Environment name validation

Valid: `local`, `dev-01`, `staging_v2`

Invalid:
- `Local` - Must be lowercase
- `1dev` - Must start with letter
- `a` - Minimum 2 characters

Pattern: `^[a-z][a-z0-9_-]{1,29}$`

### Secret value limits

- Maximum size: 64 KB
- Encoding: UTF-8

### Repository name validation

Format: `owner/repo`

Both owner and repo must be valid GitHub identifiers.
