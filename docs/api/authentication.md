---
sidebar_position: 2
title: Authentication
---

# Authentication API

Keyway supports two authentication methods: OAuth device flow (for CLIs) and GitHub Personal Access Tokens.

## OAuth Device Flow

The device flow allows CLI applications to authenticate without handling OAuth redirects.

### 1. Start the flow

```http
POST /v1/auth/device/start
Content-Type: application/json

{
  "repository": "owner/repo"  // optional, for suggested repo
}
```

**Response:**

```json
{
  "data": {
    "deviceCode": "abc123...",
    "userCode": "ABCD-1234",
    "verificationUri": "https://keyway.sh/device",
    "verificationUriComplete": "https://keyway.sh/device?user_code=ABCD-1234",
    "expiresIn": 900,
    "interval": 5
  }
}
```

### 2. User visits verification URL

Direct the user to `verificationUriComplete` or have them manually enter the `userCode` at `verificationUri`.

### 3. Poll for completion

```http
POST /v1/auth/device/poll
Content-Type: application/json

{
  "deviceCode": "abc123..."
}
```

**Pending response:**

```json
{
  "data": {
    "status": "pending"
  }
}
```

**Approved response:**

```json
{
  "data": {
    "status": "approved",
    "keywayToken": "eyJhbGciOiJIUzI1NiIs...",
    "githubLogin": "username",
    "expiresAt": "2025-02-01T00:00:00Z"
  }
}
```

**Other statuses:** `expired`, `denied`

Poll every `interval` seconds until you get a final status.

---

## GitHub PAT Validation

Validate a GitHub Fine-grained Personal Access Token:

```http
POST /v1/auth/token/validate
Authorization: Bearer ghp_xxxxxxxxxxxx
```

**Response:**

```json
{
  "data": {
    "username": "octocat",
    "githubId": 12345
  }
}
```

The PAT can then be used as a Bearer token for all API requests.

### Required PAT permissions

For full functionality, your PAT needs:

- **Repository access**: Select the repositories you want to manage
- **Permissions**: `Contents: Read` (minimum), `Metadata: Read`

---

## Web OAuth Flow

For web applications, use the standard OAuth flow:

### 1. Redirect to GitHub

```http
GET /v1/auth/github/start?redirect_uri=https://yourapp.com/callback
```

Redirects to GitHub OAuth authorization.

### 2. Handle callback

After authorization, GitHub redirects to your `redirect_uri` with a `code` parameter. The Keyway API handles the token exchange automatically if using the dashboard.

---

## Logout

Clear the session (for web clients):

```http
POST /v1/auth/logout
```

**Response:**

```json
{
  "data": {
    "success": true,
    "message": "Logged out successfully"
  }
}
```
