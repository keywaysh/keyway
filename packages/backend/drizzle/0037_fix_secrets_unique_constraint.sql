-- Fix unique constraint to only apply to active (non-deleted) secrets
-- This allows creating a new secret with the same name as a soft-deleted one

-- Drop the old constraint that doesn't account for soft-delete
DROP INDEX IF EXISTS "secrets_vault_env_key_unique";

-- Create a partial unique index that only applies to active secrets
CREATE UNIQUE INDEX "secrets_vault_env_key_unique"
ON "secrets" ("vault_id", "environment", "key")
WHERE "deleted_at" IS NULL;
