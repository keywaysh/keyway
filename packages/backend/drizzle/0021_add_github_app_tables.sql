-- Migration: Add GitHub App support tables
-- This migration adds tables for GitHub App installations and tokens

-- Create enums for GitHub App installations
DO $$ BEGIN
  CREATE TYPE "installation_account_type" AS ENUM('user', 'organization');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "installation_status" AS ENUM('active', 'suspended', 'deleted');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Create github_app_installations table
CREATE TABLE IF NOT EXISTS "github_app_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" integer NOT NULL UNIQUE,
  "account_id" integer NOT NULL,
  "account_login" text NOT NULL,
  "account_type" "installation_account_type" NOT NULL,
  "status" "installation_status" NOT NULL DEFAULT 'active',
  "permissions" jsonb NOT NULL DEFAULT '{}',
  "repository_selection" text NOT NULL DEFAULT 'selected',
  "installed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "installed_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "suspended_at" timestamp,
  "deleted_at" timestamp
);
--> statement-breakpoint

-- Create github_app_installation_repos table (for 'selected' repos)
CREATE TABLE IF NOT EXISTS "github_app_installation_repos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "github_app_installations"("id") ON DELETE CASCADE,
  "repo_id" integer NOT NULL,
  "repo_full_name" text NOT NULL,
  "repo_private" boolean NOT NULL DEFAULT false,
  "added_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Create github_app_installation_tokens table (token cache)
CREATE TABLE IF NOT EXISTS "github_app_installation_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL UNIQUE REFERENCES "github_app_installations"("id") ON DELETE CASCADE,
  "encrypted_token" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_auth_tag" text NOT NULL,
  "token_encryption_version" integer NOT NULL DEFAULT 1,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Add github_app_installation_id column to vaults table
ALTER TABLE "vaults" ADD COLUMN IF NOT EXISTS "github_app_installation_id" uuid REFERENCES "github_app_installations"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_github_app_installations_account ON github_app_installations(account_id);
CREATE INDEX IF NOT EXISTS idx_github_app_installations_status ON github_app_installations(status);
CREATE INDEX IF NOT EXISTS idx_github_app_installation_repos_repo ON github_app_installation_repos(repo_full_name);
CREATE INDEX IF NOT EXISTS idx_github_app_installation_repos_installation ON github_app_installation_repos(installation_id);
CREATE INDEX IF NOT EXISTS idx_vaults_github_app_installation ON vaults(github_app_installation_id);
