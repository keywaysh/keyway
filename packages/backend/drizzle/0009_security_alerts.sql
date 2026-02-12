-- Security alerts for suspicious pull detection
-- This migration adds tables for tracking pull events and security alerts

-- Security alert type enum
DO $$ BEGIN
  CREATE TYPE "security_alert_type" AS ENUM(
    'new_device',
    'new_location',
    'impossible_travel',
    'weird_user_agent',
    'rate_anomaly'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Pull events table (logs every pull with metadata)
CREATE TABLE IF NOT EXISTS "pull_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "vault_id" uuid NOT NULL,
  "device_id" text NOT NULL,
  "ip" text NOT NULL,
  "user_agent" text,
  "country" text,
  "city" text,
  "latitude" decimal(10, 6),
  "longitude" decimal(10, 6),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Security alerts table
CREATE TABLE IF NOT EXISTS "security_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "vault_id" uuid NOT NULL,
  "device_id" text NOT NULL,
  "alert_type" "security_alert_type" NOT NULL,
  "message" text NOT NULL,
  "details" jsonb DEFAULT '{}',
  "pull_event_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign key constraints
DO $$ BEGIN
  ALTER TABLE "pull_events" ADD CONSTRAINT "pull_events_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pull_events" ADD CONSTRAINT "pull_events_vault_id_fk"
    FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_vault_id_fk"
    FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_pull_event_id_fk"
    FOREIGN KEY ("pull_event_id") REFERENCES "pull_events"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Indexes for pull_events
CREATE INDEX IF NOT EXISTS idx_pull_events_user_vault ON pull_events(user_id, vault_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_events_device ON pull_events(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_events_vault_device ON pull_events(vault_id, device_id);
CREATE INDEX IF NOT EXISTS idx_pull_events_vault_country ON pull_events(vault_id, country);

-- Indexes for security_alerts
CREATE INDEX IF NOT EXISTS idx_security_alerts_vault ON security_alerts(vault_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_dedup ON security_alerts(vault_id, device_id, alert_type, created_at DESC);
