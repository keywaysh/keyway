---
sidebar_position: 2
title: Installation
---

# Installation

Multiple ways to install Keyway CLI depending on your preferences.

## Quick Start (No Install)

Run directly with npx - no installation required:

```bash
npx @keywaysh/cli init
```

This is the fastest way to get started. Works anywhere Node.js is installed.

## Package Managers

### npm

```bash
npm install -g @keywaysh/cli
```

### pnpm

```bash
pnpm add -g @keywaysh/cli
```

### yarn

```bash
yarn global add @keywaysh/cli
```

### bun

```bash
bun add -g @keywaysh/cli
```

After installing globally, use `keyway` directly:

```bash
keyway init
keyway pull
keyway sync vercel
```

## Homebrew (macOS & Linux)

```bash
brew install keywaysh/tap/keyway
```

This installs a native binary - faster startup, no Node.js required.

## Shell Script (Linux & macOS)

```bash
curl -fsSL https://keyway.sh/install.sh | sh
```

Downloads the latest binary to `/usr/local/bin/keyway`.

## Manual Download (All Platforms)

Download pre-built binaries from [GitHub Releases](https://github.com/keywaysh/cli/releases/latest):

| Platform | Architecture | Download |
|----------|--------------|----------|
| macOS | Apple Silicon (M1/M2/M3) | `keyway-darwin-arm64` |
| macOS | Intel | `keyway-darwin-x64` |
| Linux | x64 | `keyway-linux-x64` |
| Linux | ARM64 | `keyway-linux-arm64` |
| Windows | x64 | `keyway-win-x64.exe` |

### Windows Installation

1. Download `keyway-win-x64.exe` from [releases](https://github.com/keywaysh/cli/releases/latest)
2. Rename to `keyway.exe`
3. Move to a folder in your PATH (e.g., `C:\Windows\System32` or create `C:\keyway`)
4. Run `keyway init` in your project

### Linux/macOS Manual Installation

```bash
# Download (replace URL with your platform)
curl -L -o keyway https://github.com/keywaysh/cli/releases/latest/download/keyway-linux-x64

# Make executable
chmod +x keyway

# Move to PATH
sudo mv keyway /usr/local/bin/
```

## Verify Installation

```bash
keyway --version
```

## CI/CD

For CI/CD environments, see [CI/CD Integration](/ci-cd) for GitHub Actions, GitLab CI, and more.

:::tip npx in CI
Using `npx @keywaysh/cli` in CI works but adds ~2s for package resolution. For faster builds, pre-install or use the binary.
:::

## Updating

### npm/pnpm/yarn/bun

```bash
npm update -g @keywaysh/cli
```

### Homebrew

```bash
brew upgrade keyway
```

### Manual

Re-download the latest binary from [releases](https://github.com/keywaysh/cli/releases/latest).

## Uninstalling

### npm

```bash
npm uninstall -g @keywaysh/cli
```

### Homebrew

```bash
brew uninstall keyway
```

### Manual

```bash
rm /usr/local/bin/keyway
rm -rf ~/.config/keyway-nodejs ~/.keyway  # Remove config (optional)
```

## Next Steps

- [Getting Started](/) - Quick start guide
- [CLI Reference](/cli) - All commands and options
