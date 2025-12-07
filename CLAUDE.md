# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Keyway Docs is the documentation site for Keyway, built with Docusaurus 3. Hosted at docs.keyway.sh.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm start            # Dev server (localhost:3000)
pnpm run build        # Production build
pnpm run serve        # Serve built site locally
pnpm run clear        # Clear Docusaurus cache
```

## Architecture

### Directory Structure
```
docs/
├── intro.md              # Getting started
├── quickstart/
│   ├── installation.md   # CLI installation
│   ├── first-vault.md    # Create first vault
│   └── team-setup.md     # Team onboarding
├── guides/
│   ├── cli-usage.md      # CLI commands
│   ├── environments.md   # Environment management
│   ├── permissions.md    # GitHub permissions & plan limits
│   ├── security.md       # Security model
│   └── ci-cd.md          # CI/CD integration
├── api/
│   ├── overview.md       # API introduction
│   ├── authentication.md # Auth methods
│   ├── vaults.md         # Vault endpoints
│   ├── secrets.md        # Secret endpoints
│   ├── environments.md   # Environment endpoints
│   ├── integrations.md   # Provider sync endpoints
│   └── users.md          # User endpoints
└── reference/
    ├── cli-commands.md   # CLI reference
    ├── error-codes.md    # Error codes (RFC 7807)
    ├── limits.md         # Plan limits & rate limits
    └── plans.md          # Pricing & plans
```

### Configuration

- `docusaurus.config.ts` - Site config, navbar, footer
- `sidebars.ts` - Documentation sidebar structure

### Sidebar Structure

```typescript
// sidebars.ts
{
  docsSidebar: [
    'intro',
    { type: 'category', label: 'Quickstart', items: [...] },
    { type: 'category', label: 'Guides', items: [...] },
    { type: 'category', label: 'API Reference', items: [...] },
    { type: 'category', label: 'Reference', items: [...] },
  ]
}
```

## Writing Documentation

### Frontmatter

```markdown
---
sidebar_position: 1
title: Page Title
---

# Page Title

Content here...
```

### Admonitions

```markdown
:::tip Title
Helpful tip content
:::

:::info
Informational note
:::

:::caution
Warning content
:::

:::danger
Critical warning
:::
```

### Code Blocks

````markdown
```bash
keyway push -e production
```

```typescript title="example.ts"
const vault = await api.getVault(owner, repo);
```
````

### Internal Links

Use relative paths:
```markdown
See [Limits Reference](../reference/limits) for details.
```

### API Documentation Format

For API endpoints, follow this structure:
```markdown
## Endpoint Name

`METHOD /v1/path/:param`

Description of what it does.

### Request

```bash
curl https://api.keyway.sh/v1/path/value \
  -H "Authorization: Bearer $TOKEN"
```

### Response

```json
{
  "data": { ... },
  "meta": { "requestId": "..." }
}
```
```

## Key Documentation Areas

### Plan Limits (`reference/limits.md`)
- Free: 1 private repo, 2 providers, 2 envs, 20 secrets/private vault
- Pro ($9/mo): Unlimited
- Team ($29/mo): Unlimited + private org repos

### Permissions (`guides/permissions.md`)
- GitHub role hierarchy: read → triage → write → maintain → admin
- Write access required for secret modifications
- Plan-based restrictions on resources

### Error Codes (`reference/error-codes.md`)
- RFC 7807 format
- Plan limit errors include `upgradeUrl`

## Building

```bash
pnpm run build
```

Build output goes to `build/` directory. Broken links cause build failure (strict mode).
