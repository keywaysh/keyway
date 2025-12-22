-- Migration: Add multi-forge support
-- Adds forge_type enum and forge identifiers to support GitHub, GitLab, Bitbucket

-- 1. Create forge_type enum
DO $$ BEGIN
  CREATE TYPE "forge_type" AS ENUM ('github', 'gitlab', 'bitbucket');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add forge columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "forge_type" "forge_type" NOT NULL DEFAULT 'github';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "forge_user_id" text;

-- 3. Migrate existing github_id data to forge_user_id (only if github_id exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'github_id'
  ) THEN
    UPDATE "users" SET "forge_user_id" = "github_id"::text
      WHERE "forge_user_id" IS NULL;
  END IF;
END $$;

-- 4. Make forge_user_id NOT NULL (only if data is migrated)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE "forge_user_id" IS NULL) THEN
    ALTER TABLE "users" ALTER COLUMN "forge_user_id" SET NOT NULL;
  END IF;
END $$;

-- 5. Add unique constraint for forge identity
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_forge_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_forge_unique" UNIQUE("forge_type", "forge_user_id");
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 6. Add forge_type to vaults table
ALTER TABLE "vaults" ADD COLUMN IF NOT EXISTS "forge_type" "forge_type" NOT NULL DEFAULT 'github';

-- 7. Update vaults unique constraint to be per-forge
ALTER TABLE "vaults" DROP CONSTRAINT IF EXISTS "vaults_repo_full_name_unique";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vaults_forge_repo_unique') THEN
    ALTER TABLE "vaults" ADD CONSTRAINT "vaults_forge_repo_unique" UNIQUE("forge_type", "repo_full_name");
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 8. Add forge columns to organizations table
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "forge_type" "forge_type" NOT NULL DEFAULT 'github';
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "forge_org_id" text;

-- Migrate github_org_id to forge_org_id (only if github_org_id exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'github_org_id'
  ) THEN
    UPDATE "organizations" SET "forge_org_id" = "github_org_id"::text
      WHERE "forge_org_id" IS NULL;
  END IF;
END $$;

-- Make forge_org_id NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organizations" WHERE "forge_org_id" IS NULL) THEN
    ALTER TABLE "organizations" ALTER COLUMN "forge_org_id" SET NOT NULL;
  END IF;
END $$;

-- Update organizations unique constraint
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_github_org_id_unique";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_forge_unique') THEN
    ALTER TABLE "organizations" ADD CONSTRAINT "organizations_forge_unique" UNIQUE("forge_type", "forge_org_id");
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 9. Add forge_type to github_app_installations (may be renamed to vcs_app_installations later)
DO $$
DECLARE
  tbl_name text;
BEGIN
  -- Find which table name exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vcs_app_installations') THEN
    tbl_name := 'vcs_app_installations';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_app_installations') THEN
    tbl_name := 'github_app_installations';
  ELSE
    RETURN; -- Table doesn't exist, skip
  END IF;

  -- Add forge_type column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = tbl_name AND column_name = 'forge_type'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN "forge_type" "forge_type" NOT NULL DEFAULT ''github''', tbl_name);
  END IF;
END $$;

-- Update unique constraint (drop old constraint from either table name)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_app_installations') THEN
    ALTER TABLE "github_app_installations" DROP CONSTRAINT IF EXISTS "github_app_installations_installation_id_key";
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vcs_app_installations') THEN
    ALTER TABLE "vcs_app_installations" DROP CONSTRAINT IF EXISTS "github_app_installations_installation_id_key";
  END IF;
END $$;

DO $$
DECLARE
  tbl_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vcs_app_installations') THEN
    tbl_name := 'vcs_app_installations';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_app_installations') THEN
    tbl_name := 'github_app_installations';
  ELSE
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vcs_app_installations_forge_unique') THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT "vcs_app_installations_forge_unique" UNIQUE("forge_type", "installation_id")', tbl_name);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 10. Drop old columns (keeping as backup for now, uncomment in future)
-- ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_github_id_unique";
-- ALTER TABLE "users" DROP COLUMN IF EXISTS "github_id";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "github_org_id";

-- 11. Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_users_forge_type" ON "users" ("forge_type");
CREATE INDEX IF NOT EXISTS "idx_vaults_forge_type" ON "vaults" ("forge_type");
CREATE INDEX IF NOT EXISTS "idx_organizations_forge_type" ON "organizations" ("forge_type");
