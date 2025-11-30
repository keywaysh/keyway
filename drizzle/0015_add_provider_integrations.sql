-- Migration: Add provider integrations tables (provider_connections, vault_syncs, sync_logs)
-- Created: 2025-11-28

-- Create sync status enum
DO $$ BEGIN
  CREATE TYPE "sync_status" AS ENUM('success', 'failed', 'partial');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create sync direction enum
DO $$ BEGIN
  CREATE TYPE "sync_direction" AS ENUM('push', 'pull');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create provider_connections table (stores OAuth tokens for Vercel, Netlify, etc.)
CREATE TABLE IF NOT EXISTS "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text,
	"provider_team_id" text,
	"encrypted_access_token" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_auth_tag" text NOT NULL,
	"encrypted_refresh_token" text,
	"refresh_token_iv" text,
	"refresh_token_auth_tag" text,
	"token_expires_at" timestamp,
	"scopes" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create vault_syncs table (links a vault to a provider project)
CREATE TABLE IF NOT EXISTS "vault_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_project_id" text NOT NULL,
	"provider_project_name" text,
	"keyway_environment" text DEFAULT 'production' NOT NULL,
	"provider_environment" text DEFAULT 'production' NOT NULL,
	"auto_sync" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Create sync_logs table (audit trail for sync operations)
CREATE TABLE IF NOT EXISTS "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_id" uuid,
	"vault_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"direction" "sync_direction" NOT NULL,
	"status" "sync_status" NOT NULL,
	"secrets_created" integer DEFAULT 0 NOT NULL,
	"secrets_updated" integer DEFAULT 0 NOT NULL,
	"secrets_deleted" integer DEFAULT 0 NOT NULL,
	"secrets_skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"triggered_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign keys for provider_connections
DO $$ BEGIN
  ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add foreign keys for vault_syncs
DO $$ BEGIN
  ALTER TABLE "vault_syncs" ADD CONSTRAINT "vault_syncs_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "vault_syncs" ADD CONSTRAINT "vault_syncs_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add foreign keys for sync_logs
DO $$ BEGIN
  ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_sync_id_vault_syncs_id_fk" FOREIGN KEY ("sync_id") REFERENCES "vault_syncs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create indexes for provider_connections
CREATE INDEX IF NOT EXISTS "provider_connections_user_id_idx" ON "provider_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "provider_connections_provider_idx" ON "provider_connections" ("provider");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_connections_user_provider_team_idx" ON "provider_connections" ("user_id", "provider", "provider_team_id");

-- Create indexes for vault_syncs
CREATE INDEX IF NOT EXISTS "vault_syncs_vault_id_idx" ON "vault_syncs" ("vault_id");
CREATE INDEX IF NOT EXISTS "vault_syncs_connection_id_idx" ON "vault_syncs" ("connection_id");
CREATE UNIQUE INDEX IF NOT EXISTS "vault_syncs_vault_provider_project_env_idx" ON "vault_syncs" ("vault_id", "provider", "provider_project_id", "provider_environment");

-- Create indexes for sync_logs
CREATE INDEX IF NOT EXISTS "sync_logs_vault_id_idx" ON "sync_logs" ("vault_id");
CREATE INDEX IF NOT EXISTS "sync_logs_sync_id_idx" ON "sync_logs" ("sync_id");
CREATE INDEX IF NOT EXISTS "sync_logs_created_at_idx" ON "sync_logs" ("created_at");
