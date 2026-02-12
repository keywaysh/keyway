-- Add encryption version tracking for future algorithm changes
-- All existing data is encrypted with version 1 (AES-256-GCM)

-- Secrets
ALTER TABLE secrets ADD COLUMN encryption_version INTEGER NOT NULL DEFAULT 1;

-- Users (GitHub access tokens)
ALTER TABLE users ADD COLUMN token_encryption_version INTEGER NOT NULL DEFAULT 1;
