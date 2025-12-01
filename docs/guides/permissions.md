---
sidebar_position: 3
title: Permissions
---

# Permissions and Access Control

Keyway uses GitHub repository permissions for access control. If you have access to a repository on GitHub, you have access to its secrets in Keyway.

## How it works

```
GitHub Repository Access → Keyway Vault Access
```

When you request secrets, Keyway:
1. Verifies your identity via GitHub
2. Checks your permission level on the repository
3. Grants the same level of access to the vault

## Permission levels

| GitHub Role | Keyway Access |
|-------------|---------------|
| **Admin** | Full access - create vault, manage environments, read/write secrets |
| **Write** | Read and write secrets |
| **Read** | Read secrets only |
| **None** | No access |

## Admin capabilities

Repository admins can:

- Initialize vaults (`keyway init`)
- Create, rename, and delete environments (via dashboard or API)
- Delete vaults
- All read/write operations

## Write access capabilities

Users with write access can:

- Push secrets (`keyway push`)
- Pull secrets (`keyway pull`)
- Create and update individual secrets
- Delete individual secrets

## Read access capabilities

Users with read-only access can:

- Pull secrets (`keyway pull`)
- List secrets
- View secret metadata

They cannot:
- Push or modify secrets
- Manage environments
- Delete anything

## Managing team access

### Adding team members

Add users as collaborators on your GitHub repository:

1. Go to your repository on GitHub
2. Settings → Collaborators and teams
3. Add people or teams with appropriate access

They'll automatically have Keyway access on their next login.

### Removing access

Remove the user from your GitHub repository. Their Keyway access is revoked immediately.

### Organization teams

For GitHub organizations, you can use teams:

1. Create a team in your organization
2. Add the team to your repository
3. All team members inherit repository access

## Checking your access

### Via CLI

```bash
keyway doctor
```

Shows your current access level for the detected repository.

### Via API

```bash
curl https://api.keyway.sh/v1/vaults/owner/repo \
  -H "Authorization: Bearer $TOKEN"
```

The response includes your `permission` level.

## Common scenarios

### New team member can't access secrets

1. Verify they're added to the GitHub repository
2. Check their permission level (need at least read access)
3. Have them run `keyway login` to refresh their token

### Contractor with limited access

Give contractors read-only access on GitHub. They can pull secrets but cannot modify them.

### Rotating team off a project

Remove them from the GitHub repository. Consider rotating any secrets they had access to.

## Security considerations

### Principle of least privilege

Give users the minimum access they need:

- Developers typically need write access
- CI/CD systems may only need read access
- Contractors might only need read access

### Audit trail

Keyway logs all secret access. Contact support for audit logs if needed.

### Token security

- CLI tokens are stored in `~/.config/keyway/config.json`
- Tokens expire after 30 days
- Revoke tokens by logging out: `keyway logout`
