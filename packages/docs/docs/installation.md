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

Installs the latest release to `~/.local/bin/keyway` and adds `~/.local/bin` to your PATH in `~/.zshrc` or `~/.bashrc`. Run it again to upgrade. Set `KEYWAY_INSTALL_DIR` to install elsewhere, or `KEYWAY_VERSION` (for example `v0.6.0`) to pin a version.

## Windows

Download `keyway_<version>_windows_amd64.zip` (or `windows_arm64`) from the latest `cli/v*` release on [GitHub Releases](https://github.com/keywaysh/keyway/releases), extract `keyway.exe`, and add its folder to your PATH.

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
# Homebrew (brew update first: it refetches the tap with the new version)
brew update && brew upgrade keyway

# npm
npm update -g @keywaysh/cli
```

## Next Steps

- [Getting Started](/) - Quick start guide
- [CLI Reference](/cli) - All commands and options
