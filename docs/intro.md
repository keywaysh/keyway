---
slug: /
sidebar_position: 1
title: Introduction
---

# Keyway Documentation

Keyway is a **GitHub-native secrets management** platform. If you have access to a GitHub repository, you automatically get access to its secrets - no separate access control to manage.

## Why Keyway?

- **GitHub-based access control**: Your team's repo permissions = their secret permissions
- **CLI-first workflow**: Push and pull secrets like you push code
- **End-to-end encryption**: AES-256-GCM encryption at rest
- **Environment support**: Separate secrets for local, dev, staging, production

## How it works

1. **Install the CLI**: `npm install -g @keywaysh/cli`
2. **Login**: `keyway login` (authenticates via GitHub)
3. **Initialize a vault**: `keyway init` (in any GitHub repo)
4. **Push secrets**: `keyway push` (syncs your `.env` file)
5. **Pull secrets**: `keyway pull` (downloads secrets to `.env`)

Your team members with repo access can immediately pull secrets - no invitations needed.

## Quick links

- [Installation](/quickstart/installation) - Get started in 2 minutes
- [API Reference](/api/overview) - REST API documentation
- [CLI Commands](/reference/cli-commands) - Full CLI reference

## Architecture overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI       │────▶│   Keyway    │────▶│   GitHub    │
│  (your PC)  │     │    API      │     │    API      │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  PostgreSQL │
                    │ (encrypted) │
                    └─────────────┘
```

- **CLI** authenticates you via GitHub OAuth
- **API** verifies your repo access via GitHub API
- **Secrets** are encrypted with AES-256-GCM before storage
