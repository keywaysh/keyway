-- Migration: Rename GitHub-specific tables/columns to VCS-generic names
-- This completes the multi-forge abstraction
-- All operations are idempotent for safe re-execution

-- 1. Rename github_app_installations table to vcs_app_installations (if not already renamed)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_app_installations') THEN
    ALTER TABLE "github_app_installations" RENAME TO "vcs_app_installations";
  END IF;
END $$;

-- 2. Rename github_app_installation_repos to vcs_app_installation_repos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_app_installation_repos') THEN
    ALTER TABLE "github_app_installation_repos" RENAME TO "vcs_app_installation_repos";
  END IF;
END $$;

-- 3. Rename github_app_installation_tokens to vcs_app_installation_tokens
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_app_installation_tokens') THEN
    ALTER TABLE "github_app_installation_tokens" RENAME TO "vcs_app_installation_tokens";
  END IF;
END $$;

-- 4. Rename column in vaults (github_app_installation_id -> vcs_app_installation_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vaults' AND column_name = 'github_app_installation_id'
  ) THEN
    ALTER TABLE "vaults" RENAME COLUMN "github_app_installation_id" TO "vcs_app_installation_id";
  END IF;
END $$;

-- 5. Rename column in organization_members (github_org_membership_state -> membership_state)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization_members' AND column_name = 'github_org_membership_state'
  ) THEN
    ALTER TABLE "organization_members" RENAME COLUMN "github_org_membership_state" TO "membership_state";
  END IF;
END $$;

-- 6. Update foreign key constraints (drop old and recreate with new names)
ALTER TABLE "vaults" DROP CONSTRAINT IF EXISTS "vaults_github_app_installation_id_fkey";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vcs_app_installations') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vaults_vcs_app_installation_id_fkey') THEN
      ALTER TABLE "vaults"
        ADD CONSTRAINT "vaults_vcs_app_installation_id_fkey"
        FOREIGN KEY ("vcs_app_installation_id")
        REFERENCES "vcs_app_installations"("id")
        ON DELETE SET NULL;
    END IF;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_column THEN null;
END $$;

-- 7. Rename indexes (drop old, create new if column exists)
DROP INDEX IF EXISTS "idx_vaults_github_app_installation";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vaults' AND column_name = 'vcs_app_installation_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS "idx_vaults_vcs_app_installation" ON "vaults" ("vcs_app_installation_id");
  END IF;
END $$;

DROP INDEX IF EXISTS "idx_github_app_installations_account";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vcs_app_installations') THEN
    CREATE INDEX IF NOT EXISTS "idx_vcs_app_installations_account" ON "vcs_app_installations" ("account_id");
    CREATE INDEX IF NOT EXISTS "idx_vcs_app_installations_status" ON "vcs_app_installations" ("status");
  END IF;
END $$;

DROP INDEX IF EXISTS "idx_github_app_installations_status";
DROP INDEX IF EXISTS "idx_github_app_installation_repos_repo";
DROP INDEX IF EXISTS "idx_github_app_installation_repos_installation";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vcs_app_installation_repos') THEN
    CREATE INDEX IF NOT EXISTS "idx_vcs_app_installation_repos_repo" ON "vcs_app_installation_repos" ("repo_full_name");
    CREATE INDEX IF NOT EXISTS "idx_vcs_app_installation_repos_installation" ON "vcs_app_installation_repos" ("installation_id");
  END IF;
END $$;

-- 8. Drop old columns that have been migrated (safe - data already copied in 0033)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_github_id_unique";
ALTER TABLE "users" DROP COLUMN IF EXISTS "github_id";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "github_org_id";
