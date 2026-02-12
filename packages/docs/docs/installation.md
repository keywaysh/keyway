---
sidebar_position: 2
title: Installation
---

# Installation

## Homebrew (Recommended)

```bash
brew install keywaysh/tap/keyway
```

Native binary — fast startup, no dependencies.

Works on **macOS** and **Linux**.

## Shell Script

```bash
curl -fsSL https://keyway.sh/install.sh | sh
```

Downloads the binary to `/usr/local/bin/keyway`.

## Windows

Download `keyway-win-x64.exe` from [GitHub Releases](https://github.com/keywaysh/keyway/releases), rename to `keyway.exe`, and add to your PATH.

## npm

If you prefer npm (requires Node.js):

```bash
npm install -g @keywaysh/cli
```

Also works with pnpm, yarn, or bun.

:::tip Why Homebrew over npm?
The Homebrew version is a native Go binary — no Node.js required, ~10x faster startup. Use npm only if you don't have Homebrew.
:::

## Manual Download

Pre-built binaries for all platforms:

| Platform | Architecture | Download |
|----------|--------------|----------|
| macOS | Apple Silicon | `keyway-darwin-arm64` |
| macOS | Intel | `keyway-darwin-x64` |
| Linux | x64 | `keyway-linux-x64` |
| Linux | ARM64 | `keyway-linux-arm64` |
| Windows | x64 | `keyway-win-x64.exe` |

Download from [GitHub Releases](https://github.com/keywaysh/keyway/releases).

## Verify Installation

```bash
keyway --version
```

## Updating

```bash
# Homebrew
brew upgrade keyway

# npm
npm update -g @keywaysh/cli
```

## Next Steps

- [Getting Started](/) - Quick start guide
- [CLI Reference](/cli) - All commands and options
