---
sidebar_position: 3
title: Team Setup
---

# Team Setup

Keyway uses GitHub's permission model - **if someone has access to the repo, they can access the secrets**.

## How permissions work

| GitHub Role | Secret Access |
|-------------|---------------|
| **Admin** | Full access + manage environments |
| **Maintain** | Read & write secrets |
| **Write** | Read & write secrets |
| **Triage** | Read-only access |
| **Read** | Read-only access |

No separate invitations needed. Add team members to your GitHub repo, and they're automatically authorized.

## Onboarding a team member

### 1. Add them to the GitHub repo

Go to your repository settings → Collaborators → Add people.

### 2. They install and login

```bash
npm install -g @keywaysh/cli
keyway login
```

### 3. They pull secrets

```bash
git clone git@github.com:your-org/your-project.git
cd your-project
keyway pull
```

That's it! They now have access to the secrets.

## Environment-specific permissions

By default, all environments inherit GitHub repo permissions. Admins can customize this:

```bash
# Restrict production to admins only
keyway permissions set production --read admin --write admin
```

Or via the [dashboard](https://keyway.sh/dashboard).

## Audit trail

All secret operations are logged. View activity in the dashboard or via API:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.keyway.sh/v1/activity
```

## Best practices

1. **Use GitHub teams** for easier permission management
2. **Create environment-specific restrictions** for production secrets
3. **Review the audit log** regularly
4. **Rotate secrets** after team member departures

## Next steps

- [Manage environments](/guides/environments)
- [Configure permissions](/guides/permissions)
