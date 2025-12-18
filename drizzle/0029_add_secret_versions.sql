-- Secret versions table for version history
CREATE TABLE IF NOT EXISTS "secret_versions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "secret_id" uuid NOT NULL REFERENCES "secrets"("id") ON DELETE CASCADE,
    "vault_id" uuid NOT NULL REFERENCES "vaults"("id") ON DELETE CASCADE,
    "version_number" integer NOT NULL,
    "encrypted_value" text NOT NULL,
    "iv" text NOT NULL,
    "auth_tag" text NOT NULL,
    "encryption_version" integer NOT NULL DEFAULT 1,
    "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Index for fast version lookups by secret
CREATE INDEX IF NOT EXISTS "idx_secret_versions_secret_id" ON "secret_versions" ("secret_id");

-- Index for fast version lookups by vault (for cleanup)
CREATE INDEX IF NOT EXISTS "idx_secret_versions_vault_id" ON "secret_versions" ("vault_id");

-- Unique constraint to ensure version numbers are unique per secret
CREATE UNIQUE INDEX IF NOT EXISTS "idx_secret_versions_secret_version"
    ON "secret_versions" ("secret_id", "version_number");

-- Add 'secret_version_restored' to activity_action enum
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'secret_version_restored';
