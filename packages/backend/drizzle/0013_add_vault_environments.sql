-- Migration: Add environments column to vaults table
-- Created: 2025-11-28

-- 1. Add environments column with default value
ALTER TABLE "vaults" ADD COLUMN IF NOT EXISTS "environments" TEXT[] NOT NULL DEFAULT ARRAY['local', 'dev', 'staging', 'production'];

-- 2. Merge existing environments from secrets into each vault's list
-- This ensures no orphaned secrets (environments that exist in secrets but not in vault.environments)
UPDATE vaults v
SET environments = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(
      ARRAY['local', 'dev', 'staging', 'production'] ||
      COALESCE(ARRAY(SELECT DISTINCT environment FROM secrets WHERE vault_id = v.id), ARRAY[]::TEXT[])
    )
    ORDER BY 1
  )
);
