---
sidebar_position: 2
title: Your First Vault
---

# Your First Vault

A **vault** is a secure container for secrets, linked to a GitHub repository. Let's create one.

## Prerequisites

- [CLI installed](/quickstart/installation)
- Logged in (`keyway login`)
- Inside a git repository with a GitHub remote

## Initialize a vault

Navigate to your project directory and run:

```bash
cd your-project
keyway init
```

The CLI automatically detects the GitHub repository from your git remote.

```
✓ Detected repository: your-username/your-project
✓ Vault created successfully!

You can now push secrets with: keyway push
```

## Push your first secrets

Create or use an existing `.env` file:

```bash title=".env"
DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=sk_test_abc123
SECRET_TOKEN=super_secret_value
```

Push it to Keyway:

```bash
keyway push
```

```
✓ Pushed 3 secrets to local environment
  - DATABASE_URL
  - API_KEY
  - SECRET_TOKEN
```

By default, secrets are pushed to the `local` environment. Use `-e` to specify a different one:

```bash
keyway push -e production
```

## Pull secrets

On another machine (or after cloning the repo), pull the secrets:

```bash
keyway pull
```

```
✓ Pulled 3 secrets to .env
```

This downloads the secrets and writes them to your `.env` file.

## Check your setup

Run the doctor command to verify everything is configured correctly:

```bash
keyway doctor
```

```
✓ Git repository detected
✓ GitHub remote found: your-username/your-project
✓ Authenticated as: your-username
✓ Vault exists for this repository
✓ 3 secrets in local environment
```

## Next steps

- [Set up your team](/quickstart/team-setup)
- [Learn about environments](/guides/environments)
