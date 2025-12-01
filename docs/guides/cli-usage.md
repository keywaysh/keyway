---
sidebar_position: 1
title: CLI Usage
---

# CLI Usage Guide

The Keyway CLI is designed for daily workflow integration. This guide covers common usage patterns.

## Basic workflow

### Pull secrets before starting work

```bash
# Pull secrets for your current environment
keyway pull

# Pull for a specific environment
keyway pull -e staging
```

### Push after adding new secrets

```bash
# Push your local .env changes
keyway push

# Push to a specific environment
keyway push -e production
```

## Working with multiple environments

Most projects have several environments. Keyway makes it easy to switch between them.

### Pull from different environments

```bash
# Development (default)
keyway pull

# Staging for testing
keyway pull -e staging

# Production (be careful!)
keyway pull -e production
```

### Compare environments

```bash
# Pull staging to compare with local
keyway pull -e staging -f .env.staging
diff .env .env.staging
```

## Team collaboration patterns

### Onboarding a new team member

1. New member installs the CLI:
   ```bash
   npm install -g @keywaysh/cli
   ```

2. They authenticate:
   ```bash
   keyway login
   ```

3. They pull secrets (if they have repo access):
   ```bash
   cd project-directory
   keyway pull
   ```

That's it! No manual secret sharing needed.

### Adding a new secret

When you add a secret that the team needs:

```bash
# Add to your .env file
echo "NEW_API_KEY=abc123" >> .env

# Push to share with team
keyway push

# Notify team to pull
# (or they'll get it on next pull)
```

## Environment file management

### Default file locations

Keyway looks for these files in order:
1. `.env.local`
2. `.env`

### Custom file paths

```bash
# Read from custom file
keyway push -f .env.development

# Write to custom file
keyway pull -f .env.local
```

### Gitignore setup

Always exclude secret files from git:

```bash
# .gitignore
.env
.env.local
.env.*.local
```

## Scripting and automation

### Non-interactive mode

For scripts, use the `--yes` flag to skip confirmations:

```bash
keyway push --yes
keyway pull --yes
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication required |
| 3 | No vault found |

### Example script

```bash
#!/bin/bash
set -e

# Pull latest secrets
keyway pull --yes

# Run your application
npm start
```

## Troubleshooting

### Check your setup

```bash
keyway doctor
```

This verifies:
- Authentication status
- Git repository detection
- Vault existence
- Network connectivity

### Common issues

**"No vault found for this repository"**

Initialize a vault first:
```bash
keyway init
```

**"Authentication required"**

Log in again:
```bash
keyway login
```

**"Permission denied"**

You need repository access on GitHub. Ask a repo admin to add you as a collaborator.

### Debug mode

For detailed output:
```bash
keyway pull --verbose
```
