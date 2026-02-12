-- Migration: Add trial fields to organizations
-- Adds trial period support for Team plan (15-day free trial)

-- Add trial-related columns to organizations
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_started_at" timestamp;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_converted_at" timestamp;

-- Add index for active trials
CREATE INDEX IF NOT EXISTS "idx_organizations_trial_ends_at" ON "organizations" ("trial_ends_at")
  WHERE "trial_ends_at" IS NOT NULL AND "trial_converted_at" IS NULL;

-- Add trial actions to activity_action enum if not already present
DO $$ BEGIN
  ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'org_trial_started';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'org_trial_expired';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'org_trial_converted';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
