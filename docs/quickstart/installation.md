---
sidebar_position: 1
title: Installation
---

# Installation

Install the Keyway CLI globally using npm, pnpm, or yarn.

## npm

```bash
npm install -g @keywaysh/cli
```

## pnpm

```bash
pnpm add -g @keywaysh/cli
```

## yarn

```bash
yarn global add @keywaysh/cli
```

## Verify installation

```bash
keyway --version
```

You should see the version number printed.

## Login

Before using Keyway, authenticate with your GitHub account:

```bash
keyway login
```

This opens a browser window for GitHub OAuth. Once authenticated, the CLI stores a secure token locally.

### Using a Personal Access Token (PAT)

Alternatively, you can use a GitHub Fine-grained Personal Access Token:

```bash
keyway login --pat
```

This is useful for CI/CD environments or when browser-based auth isn't available.

## Requirements

- **Node.js** 18 or higher
- **Git** installed and configured
- A GitHub account with access to at least one repository

## Next steps

- [Create your first vault](/quickstart/first-vault)
