-- Migration: Dashboard API
-- Breaking change: secrets table restructured for individual key-value storage

-- Create new enums
DO $$ BEGIN
  CREATE TYPE "activity_action" AS ENUM('vault_created', 'secrets_pushed', 'secrets_pulled', 'secret_created', 'secret_updated', 'secret_deleted', 'secret_rotated', 'permission_changed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "activity_platform" AS ENUM('cli', 'web', 'api');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Drop old secrets table and recreate with new structure
DROP TABLE IF EXISTS "secrets" CASCADE;
--> statement-breakpoint

-- Create new secrets table with individual key-value storage
CREATE TABLE IF NOT EXISTS "secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vault_id" uuid NOT NULL,
  "environment" text DEFAULT 'default' NOT NULL,
  "key" text NOT NULL,
  "encrypted_value" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Add foreign key for secrets
DO $$ BEGIN
  ALTER TABLE "secrets" ADD CONSTRAINT "secrets_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Create activity_logs table
CREATE TABLE IF NOT EXISTS "activity_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "vault_id" uuid,
  "action" "activity_action" NOT NULL,
  "platform" "activity_platform" NOT NULL,
  "metadata" text,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Add foreign keys for activity_logs
DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "secrets_vault_env_idx" ON "secrets" ("vault_id", "environment");
CREATE INDEX IF NOT EXISTS "secrets_vault_key_env_idx" ON "secrets" ("vault_id", "key", "environment");
CREATE INDEX IF NOT EXISTS "activity_logs_user_id_idx" ON "activity_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "activity_logs_vault_id_idx" ON "activity_logs" ("vault_id");
CREATE INDEX IF NOT EXISTS "activity_logs_created_at_idx" ON "activity_logs" ("created_at" DESC);
