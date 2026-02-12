-- Add environment_type enum for explicit environment protection levels
DO $$ BEGIN
  CREATE TYPE "environment_type" AS ENUM('protected', 'standard', 'development');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create vault_environments table for explicit environment type storage
CREATE TABLE IF NOT EXISTS "vault_environments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vault_id" uuid NOT NULL REFERENCES "vaults"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" "environment_type" NOT NULL DEFAULT 'standard',
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vault_environments_vault_name_unique" UNIQUE("vault_id", "name")
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS "vault_environments_vault_id_idx" ON "vault_environments" ("vault_id");

-- Migrate existing environments from vaults.environments array to vault_environments table
-- This populates the new table with inferred types based on environment names
INSERT INTO "vault_environments" ("vault_id", "name", "type", "display_order")
SELECT
  v.id as vault_id,
  env_name as name,
  CASE
    WHEN lower(env_name) IN ('production', 'prod', 'main', 'master') THEN 'protected'::environment_type
    WHEN lower(env_name) IN ('dev', 'development', 'local') THEN 'development'::environment_type
    ELSE 'standard'::environment_type
  END as type,
  (row_number() OVER (PARTITION BY v.id ORDER BY
    CASE
      WHEN lower(env_name) IN ('production', 'prod', 'main', 'master') THEN 1
      WHEN lower(env_name) IN ('staging', 'test', 'qa') THEN 2
      WHEN lower(env_name) IN ('dev', 'development', 'local') THEN 3
      ELSE 4
    END
  ) - 1)::integer as display_order
FROM "vaults" v
CROSS JOIN LATERAL unnest(v.environments) as env_name
WHERE array_length(v.environments, 1) > 0
ON CONFLICT ("vault_id", "name") DO NOTHING;
