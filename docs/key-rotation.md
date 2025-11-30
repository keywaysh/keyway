# Encryption Key Rotation

This guide explains how to rotate the encryption key used by Keyway to protect secrets and tokens.

## Overview

Keyway uses AES-256-GCM encryption via an isolated Go microservice (`keyway-crypto`). The encryption key never touches the backend - all crypto operations happen via gRPC.

Key rotation is a zero-downtime process:
1. Add the new key alongside the old one
2. Migrate all encrypted data to the new key
3. Remove the old key

## Prerequisites

- Access to the `keyway-crypto` service configuration
- Access to run the rotation script on the backend
- Database backup (recommended)

## Running on Railway

Railway doesn't provide shell access, but you can run one-off commands via the Railway CLI:

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and link to your project
railway login
railway link

# Dry run first
railway run -s keyway-backend pnpm run rotate-key -- --dry-run

# Execute rotation
railway run -s keyway-backend pnpm run rotate-key
```

## Step-by-Step Guide

### 1. Generate a New Key

```bash
# Generate a 32-byte (256-bit) key in hex format
openssl rand -hex 32
```

Save this key securely - you'll need it for the configuration.

### 2. Update Crypto Service Configuration

Change from single-key format:
```bash
ENCRYPTION_KEY=<old_key>
```

To multi-key format:
```bash
ENCRYPTION_KEYS="1:<old_key>,2:<new_key>"
```

The format is `version:hex_key` pairs, comma-separated. Version numbers must be >= 1.

### 3. Deploy the Crypto Service

Restart or redeploy `keyway-crypto` with the new configuration. The service will:
- Load both keys
- Use the highest version (2) for new encryptions
- Support decryption with any available version

Verify with logs:
```
Loaded 2 encryption key(s), current version: 2, available versions: [1 2]
```

### 4. Run the Rotation Script

First, do a dry run to see what would be migrated:

```bash
cd keyway-backend
pnpm run rotate-key -- --dry-run
```

Output shows counts of secrets, provider tokens, and user tokens to rotate.

When ready, run the actual migration:

```bash
pnpm run rotate-key
```

For large databases, adjust batch size:

```bash
pnpm run rotate-key -- --batch-size=50
```

### 5. Verify Migration

The script outputs a summary:
```
📊 Rotation Summary
==================================================

Secrets:
   Total: 150
   Rotated: 150
   Failed: 0

Provider Tokens:
   Total: 10
   Rotated: 10
   Failed: 0

User Tokens:
   Total: 25
   Rotated: 25
   Failed: 0

✅ Key rotation completed successfully!
```

### 6. Remove the Old Key

Once all data is migrated, update the configuration to remove the old key:

```bash
ENCRYPTION_KEYS="2:<new_key>"
```

Or use single-key format with version 2:
```bash
ENCRYPTION_KEY=<new_key>
# Note: This will use version 1, so keep using ENCRYPTION_KEYS format
```

Redeploy `keyway-crypto`.

## Emergency Key Rotation

If a key is compromised:

1. **Immediately** generate a new key and update `ENCRYPTION_KEYS`
2. Redeploy `keyway-crypto`
3. Run the rotation script with higher priority
4. Remove the compromised key
5. Consider invalidating affected user sessions

## Troubleshooting

### "No key found for version X"

The crypto service doesn't have the key for that version. Ensure all required versions are in `ENCRYPTION_KEYS`.

### Rotation script fails mid-way

The script is idempotent - you can safely re-run it. It only processes records that don't match the current version.

### Large number of failures

Check:
- Crypto service is running and accessible
- All required key versions are loaded
- Database connectivity

## Architecture

```
┌─────────────────┐         ┌─────────────────────┐
│  keyway-backend │  gRPC   │   keyway-crypto     │
│                 │ ──────► │                     │
│ - No keys       │         │ - ENCRYPTION_KEYS   │
│ - Stores version│         │ - AES-256-GCM       │
└─────────────────┘         └─────────────────────┘
```

The backend never sees encryption keys. It only:
- Sends plaintext to encrypt
- Receives ciphertext + version
- Stores the version number
- Sends ciphertext + version to decrypt

This isolation ensures the backend can be compromised without exposing the encryption keys.
