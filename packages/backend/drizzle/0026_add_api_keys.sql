-- Add API Keys table for programmatic access

-- Create enum for API key environment
DO $$ BEGIN
    CREATE TYPE "api_key_environment" AS ENUM('live', 'test');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create api_keys table
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "key_prefix" text NOT NULL,
    "key_hash" text NOT NULL UNIQUE,
    "environment" "api_key_environment" NOT NULL,
    "scopes" text[] NOT NULL DEFAULT '{}',
    "expires_at" timestamp,
    "last_used_at" timestamp,
    "usage_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "revoked_at" timestamp,
    "revoked_reason" text,
    "allowed_ips" text[],
    "created_from_ip" text,
    "created_user_agent" text
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "idx_api_keys_user_id" ON "api_keys" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_api_keys_key_hash" ON "api_keys" ("key_hash");
