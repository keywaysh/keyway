# @keywaysh/cli

GitHub-native secrets management. If you have repo access, you get secret access.

## Quick Start

```bash
npx @keywaysh/cli init
```

No install required. This will authenticate with GitHub, create a vault, and sync your `.env`.

## Usage

```bash
npx @keywaysh/cli pull      # Pull secrets to .env
npx @keywaysh/cli run       # Run command with secrets injected
npx @keywaysh/cli push      # Push .env to vault
npx @keywaysh/cli sync      # Sync with Vercel/Railway
```

## Global Installation (optional)

For faster repeated use:

```bash
npm install -g @keywaysh/cli
keyway pull
```

## Documentation

Visit [docs.keyway.sh](https://docs.keyway.sh) for full documentation.

## License

MIT
