-- Migration: Rename GitHub App activity actions to VCS-generic names
-- This fixes the mismatch between schema.ts and database enum values

-- Rename enum values (PostgreSQL 10+)
ALTER TYPE "activity_action" RENAME VALUE 'github_app_installed' TO 'vcs_app_installed';
ALTER TYPE "activity_action" RENAME VALUE 'github_app_uninstalled' TO 'vcs_app_uninstalled';

-- Also drop the orphan UNIQUE constraint on organizations.login
-- (created in 0031, but schema now uses composite unique on forge_type + forge_org_id)
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_login_key";
