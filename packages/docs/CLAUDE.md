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
├── intro.md          # Getting started (landing page)
├── cli.md            # CLI reference
├── api.md            # API reference
├── ci-cd.md          # CI/CD integration
├── mcp.md            # MCP Server for AI tools
├── security.md       # Security & permissions
└── integrations.md   # Provider integrations (Vercel, etc.)
```

### Configuration

- `docusaurus.config.ts` - Site config, navbar, footer
- `sidebars.ts` - Documentation sidebar structure

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

:::caution
Warning content
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
See [API Reference](./api) for details.
```

## Building

```bash
pnpm run build
```

Build output goes to `build/` directory. Broken links cause build failure (strict mode).
