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
- `ADMIN_SECRET` environment variable configured on the backend
- Database backup (recommended)

## Running the Rotation

Use the admin API endpoint to run key rotation. First, configure `ADMIN_SECRET`:

```bash
# Generate an admin secret (32+ characters)
openssl rand -base64 32

# Set ADMIN_SECRET in your environment (Railway, etc.)
```

Then call the endpoint:

```bash
# Dry run first
curl -X POST "https://api.keyway.sh/v1/admin/rotate-key?dryRun=true" \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Execute rotation
curl -X POST "https://api.keyway.sh/v1/admin/rotate-key" \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# With custom batch size
curl -X POST "https://api.keyway.sh/v1/admin/rotate-key?batchSize=50" \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

Response:
```json
{
  "success": true,
  "dryRun": false,
  "targetVersion": 2,
  "secrets": { "total": 150, "rotated": 150, "failed": 0 },
  "providerTokens": { "total": 10, "rotated": 10, "failed": 0 },
  "userTokens": { "total": 25, "rotated": 25, "failed": 0 }
}
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

### 4. Run the Rotation

First, do a dry run to see what would be migrated:

```bash
curl -X POST "https://api.keyway.sh/v1/admin/rotate-key?dryRun=true" \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

When ready, run the actual migration:

```bash
curl -X POST "https://api.keyway.sh/v1/admin/rotate-key" \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

### 5. Verify Migration

Check the response for `"success": true` and `"failed": 0` for all categories.

### 6. Remove the Old Key

> ⚠️ **CRITICAL**: Only remove the old key after ALL data has been successfully migrated with **0 failures**. If any secrets, provider tokens, or user tokens remain encrypted with the old key, they will become **permanently unrecoverable** once the key is removed.

**First, verify ALL data is migrated:**

```sql
-- All should show version 2 only
SELECT encryption_version, COUNT(*) FROM secrets GROUP BY encryption_version;
SELECT token_encryption_version, COUNT(*) FROM users WHERE encrypted_access_token IS NOT NULL GROUP BY token_encryption_version;
SELECT access_token_version, COUNT(*) FROM provider_connections GROUP BY access_token_version;
```

**Then update the configuration:**

```bash
# ✅ Correct - keep the version number
ENCRYPTION_KEYS="2:<new_key>"

# ❌ WRONG - do NOT change the version number!
ENCRYPTION_KEYS="1:<new_key>"   # Data expects version 2!
ENCRYPTION_KEY=<new_key>         # Defaults to version 1!
```

> 💡 **Important**: Keep the old key backed up somewhere safe for a few days, just in case.

Redeploy `keyway-crypto`.

## Emergency Key Rotation

If a key is compromised:

1. **Immediately** generate a new key and update `ENCRYPTION_KEYS`
2. Redeploy `keyway-crypto`
3. Run the rotation via the admin endpoint
4. Remove the compromised key
5. Consider invalidating affected user sessions

## Troubleshooting

### "No key found for version X"

The crypto service doesn't have the key for that version. Ensure all required versions are in `ENCRYPTION_KEYS`.

### Rotation fails mid-way

The rotation is idempotent - you can safely re-run it. It only processes records that don't match the current version.

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
