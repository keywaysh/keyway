---
sidebar_position: 7
title: Organizations
---

# Organizations

Organizations allow teams to manage secrets centrally with shared billing and member management.

## How Organizations Work

When you install the [Keyway GitHub App](https://github.com/apps/keyway-sh) on a GitHub organization, Keyway automatically:

1. Creates an organization in Keyway
2. Syncs members from GitHub
3. Links organization repos to the org billing

**Key concept:** Organization membership mirrors GitHub. If someone is added to/removed from your GitHub org, Keyway syncs automatically.

---

## Getting Started

### 1. Install the GitHub App

Install the Keyway GitHub App on your organization:

1. Go to [github.com/apps/keyway-sh](https://github.com/apps/keyway-sh)
2. Click **Install**
3. Select your organization
4. Choose which repositories to enable

### 2. Start a Trial

Organization owners can start a 14-day Team plan trial:

1. Go to your organization in the [dashboard](https://app.keyway.sh)
2. Click **Start Trial**

Or via API:

```http
POST /v1/orgs/:org/trial/start
```

---

## Members

### Viewing Members

View organization members in the [dashboard](https://app.keyway.sh) or via API:

```http
GET /v1/orgs/:org/members
```

### Roles

| Role | Permissions |
|------|-------------|
| **Owner** | Full access: billing, settings, member sync |
| **Member** | Access based on GitHub repo permissions |

:::tip GitHub = Source of Truth
Keyway doesn't have separate member management. Add/remove people from your GitHub organization, and Keyway updates automatically.
:::

### Syncing Members

Members sync automatically when:
- Someone accesses a vault
- App webhooks fire
- Manual sync is triggered

Force a manual sync:

```http
POST /v1/orgs/:org/members/sync
```

---

## Billing

### Plans

| Feature | Free | Team |
|---------|------|------|
| Private repos | 1 | Unlimited |
| Secrets per repo | 20 | Unlimited |
| Environments | 2 | Unlimited |
| Provider syncs | 2 | Unlimited |
| Secret versions | - | 30 days |
| Audit logs | - | 90 days |

### Starting a Subscription

1. Go to your organization in the [dashboard](https://app.keyway.sh)
2. Click **Upgrade to Team**
3. Complete Stripe checkout

Or via API:

```http
POST /v1/orgs/:org/billing/checkout
{
  "priceId": "price_xxx",
  "successUrl": "https://yourapp.com/success",
  "cancelUrl": "https://yourapp.com/cancel"
}
```

### Managing Subscription

Access the Stripe billing portal:

```http
POST /v1/orgs/:org/billing/portal
{
  "returnUrl": "https://yourapp.com/settings"
}
```

### Billing Status

```http
GET /v1/orgs/:org/billing
```

Returns:
```json
{
  "data": {
    "plan": "team",
    "status": "active",
    "currentPeriodEnd": "2025-02-01T00:00:00Z",
    "cancelAtPeriodEnd": false
  }
}
```

---

## Trials

### 14-Day Team Trial

Every organization gets one free Team plan trial:

- **Duration:** 14 days
- **Features:** Full Team plan access
- **No credit card required**

### Starting a Trial

```http
POST /v1/orgs/:org/trial/start
```

Requirements:
- Must be org owner or have GitHub App installed
- Organization hasn't had a trial before
- No active subscription

### Checking Trial Status

```http
GET /v1/orgs/:org/trial
```

Returns:
```json
{
  "data": {
    "hasStarted": true,
    "isActive": true,
    "daysRemaining": 10,
    "startedAt": "2025-01-01T00:00:00Z",
    "endsAt": "2025-01-15T00:00:00Z"
  }
}
```

---

## API Reference

### List Organizations

```http
GET /v1/orgs
```

Returns all organizations the authenticated user belongs to.

### Get Organization

```http
GET /v1/orgs/:org
```

### Update Organization

```http
PUT /v1/orgs/:org
{
  "displayName": "My Company",
  "defaultPermissions": { ... }
}
```

Requires org owner role.

### List Members

```http
GET /v1/orgs/:org/members
```

### Force Sync Members

```http
POST /v1/orgs/:org/members/sync
```

Requires org owner role. Fetches latest members from GitHub.

---

## FAQ

### How is organization access determined?

Keyway checks your GitHub organization membership. If you're a member of the GitHub org, you can access organization vaults (subject to repo permissions).

### Can I have multiple organizations?

Yes. You can be a member of multiple GitHub organizations, each with their own Keyway organization.

### What happens when I remove someone from GitHub?

Their Keyway access is revoked immediately. The next sync (automatic or manual) removes them from the organization.

### Do all org members need Keyway accounts?

Members only need a Keyway account when they first access a vault. The account is created automatically via GitHub OAuth.
