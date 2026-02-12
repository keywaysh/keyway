-- Add unique constraint to prevent duplicate secret keys within the same vault/environment
-- This ensures data integrity and prevents accidental overwrites

CREATE UNIQUE INDEX IF NOT EXISTS "secrets_vault_env_key_unique"
ON "secrets" ("vault_id", "environment", "key");
