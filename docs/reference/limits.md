---
sidebar_position: 3
title: Limits
---

# Limits Reference

Resource limits and quotas for Keyway.

## Rate limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 100 requests | 15 minutes |
| Device code verification | 5 requests | 1 minute |
| Push/Pull | 30 requests | 15 minutes |

### Rate limit headers

Responses include rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312800
```

### Handling rate limits

When rate limited, you receive a `429` response:

```json
{
  "type": "https://keyway.sh/errors/rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded"
}
```

With header:
```
Retry-After: 60
```

**Best practices:**
- Implement exponential backoff
- Cache responses where possible
- Batch operations when feasible

---

## Resource limits

### Free plan

| Resource | Limit |
|----------|-------|
| Vaults | 10 |
| Secrets per vault | 100 |
| Environments per vault | 10 |
| Secret value size | 64 KB |
| Push batch size | 100 secrets |

### Pro plan

| Resource | Limit |
|----------|-------|
| Vaults | Unlimited |
| Secrets per vault | 1,000 |
| Environments per vault | 50 |
| Secret value size | 64 KB |
| Push batch size | 500 secrets |

### Team plan

| Resource | Limit |
|----------|-------|
| Vaults | Unlimited |
| Secrets per vault | Unlimited |
| Environments per vault | Unlimited |
| Secret value size | 256 KB |
| Push batch size | 1,000 secrets |

---

## API limits

### Request body size

- Maximum request body: 1 MB
- Maximum secret value: 64 KB (256 KB on Team)

### Pagination

- Default page size: 25
- Maximum page size: 100
- Use `limit` and `offset` query parameters

```bash
GET /v1/vaults?limit=50&offset=100
```

### Timeout

- Request timeout: 30 seconds
- Long-running operations may return 202 with status endpoint

---

## Naming limits

### Secret keys

| Constraint | Value |
|------------|-------|
| Minimum length | 1 character |
| Maximum length | 256 characters |
| Allowed characters | A-Z, 0-9, _ |
| Must start with | Letter |

### Environment names

| Constraint | Value |
|------------|-------|
| Minimum length | 2 characters |
| Maximum length | 30 characters |
| Allowed characters | a-z, 0-9, -, _ |
| Must start with | Letter |

### Repository names

Must be valid GitHub repository identifiers:
- Format: `owner/repo`
- Maximum owner length: 39 characters
- Maximum repo length: 100 characters

---

## Token limits

### Keyway JWT

| Property | Value |
|----------|-------|
| Expiration | 30 days |
| Refresh | Re-authenticate before expiry |

### GitHub PAT

Follow GitHub's limits:
- Fine-grained PATs: Configurable expiration
- Classic PATs: Optional expiration

---

## Audit log retention

| Plan | Retention |
|------|-----------|
| Free | 7 days |
| Pro | 30 days |
| Team | 90 days |
| Enterprise | 1 year |

---

## Increasing limits

### Upgrade your plan

Most limits can be increased by upgrading:

```
Free → Pro → Team → Enterprise
```

### Request increase

For specific limit increases on Enterprise plans, contact support@keyway.sh with:

1. Your organization name
2. The limit you need increased
3. Your use case

---

## Monitoring usage

### Via API

```bash
curl https://api.keyway.sh/v1/users/me/usage \
  -H "Authorization: Bearer $TOKEN"
```

Response:

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

### Via CLI

```bash
keyway whoami
```

Shows current plan and usage summary.
