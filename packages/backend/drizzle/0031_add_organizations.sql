-- Add organization role enum
CREATE TYPE "org_role" AS ENUM ('owner', 'member');

-- Add permission override target type enum
CREATE TYPE "override_target_type" AS ENUM ('user', 'role');

-- Create organizations table
CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "github_org_id" integer NOT NULL UNIQUE,
  "login" text NOT NULL UNIQUE,
  "display_name" text,
  "avatar_url" text,
  "plan" "user_plan" DEFAULT 'free' NOT NULL,
  "stripe_customer_id" text,
  "default_permissions" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create organization members table
CREATE TABLE "organization_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "org_role" "org_role" DEFAULT 'member' NOT NULL,
  "github_org_membership_state" text DEFAULT 'active',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_members_org_user_unique" UNIQUE("org_id", "user_id")
);

-- Create permission overrides table
CREATE TABLE "permission_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vault_id" uuid NOT NULL,
  "environment" text NOT NULL,
  "target_type" "override_target_type" NOT NULL,
  "target_user_id" uuid,
  "target_role" "collaborator_role",
  "can_read" boolean DEFAULT true NOT NULL,
  "can_write" boolean DEFAULT false NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add org_id column to vaults
ALTER TABLE "vaults" ADD COLUMN "org_id" uuid;

-- Add foreign key constraints
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_vault_id_vaults_id_fk"
  FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_target_user_id_users_id_fk"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "vaults" ADD CONSTRAINT "vaults_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Create indexes for performance
CREATE INDEX "idx_organization_members_org_id" ON "organization_members" ("org_id");
CREATE INDEX "idx_organization_members_user_id" ON "organization_members" ("user_id");
CREATE INDEX "idx_permission_overrides_vault_id" ON "permission_overrides" ("vault_id");
CREATE INDEX "idx_permission_overrides_vault_env" ON "permission_overrides" ("vault_id", "environment");
CREATE INDEX "idx_permission_overrides_target_user_id" ON "permission_overrides" ("target_user_id");
CREATE INDEX "idx_vaults_org_id" ON "vaults" ("org_id");

-- Add unique constraint for permission overrides
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_unique"
  UNIQUE ("vault_id", "environment", "target_type", "target_user_id", "target_role");
