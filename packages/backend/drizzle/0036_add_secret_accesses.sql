-- Create secret_accesses table for tracking who accessed which secrets (Exposure feature)
-- This enables offboarding: "Dev leaves? You know exactly what to rotate."

CREATE TABLE "secret_accesses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- User (snapshot fields for survival after user deletion)
  "user_id" uuid,
  "username" text NOT NULL,
  "user_avatar_url" text,

  -- Secret (snapshot fields for survival after secret deletion)
  "secret_id" uuid,
  "secret_key" text NOT NULL,

  -- Vault (snapshot fields for survival after vault deletion)
  "vault_id" uuid,
  "repo_full_name" text NOT NULL,
  "environment" text NOT NULL,

  -- Context at time of access
  "github_role" "collaborator_role" NOT NULL,
  "platform" "activity_platform" NOT NULL,
  "ip_address" text,
  "device_id" text,

  -- Timestamps
  "first_accessed_at" timestamp DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp DEFAULT now() NOT NULL,
  "access_count" integer DEFAULT 1 NOT NULL,

  -- Link to pull event for forensics
  "pull_event_id" uuid
);

-- Add foreign key constraints (ON DELETE SET NULL to preserve audit data)
ALTER TABLE "secret_accesses" ADD CONSTRAINT "secret_accesses_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "secret_accesses" ADD CONSTRAINT "secret_accesses_secret_id_secrets_id_fk"
  FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "secret_accesses" ADD CONSTRAINT "secret_accesses_vault_id_vaults_id_fk"
  FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "secret_accesses" ADD CONSTRAINT "secret_accesses_pull_event_id_pull_events_id_fk"
  FOREIGN KEY ("pull_event_id") REFERENCES "pull_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Primary index: "Which secrets did user X access?" (unique constraint for UPSERT)
CREATE UNIQUE INDEX "idx_secret_accesses_user_secret"
  ON "secret_accesses" ("user_id", "secret_id");

-- Query by user (for exposure report)
CREATE INDEX "idx_secret_accesses_user_id"
  ON "secret_accesses" ("user_id", "last_accessed_at" DESC);

-- Query by vault (for vault-level exposure view)
CREATE INDEX "idx_secret_accesses_vault_id"
  ON "secret_accesses" ("vault_id", "last_accessed_at" DESC);

-- Query by secret (for per-secret access history)
CREATE INDEX "idx_secret_accesses_secret_id"
  ON "secret_accesses" ("secret_id", "last_accessed_at" DESC);

-- Query by username (survives user deletion for compliance)
CREATE INDEX "idx_secret_accesses_username"
  ON "secret_accesses" ("username", "last_accessed_at" DESC);
