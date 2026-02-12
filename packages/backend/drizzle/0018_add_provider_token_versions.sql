-- Add encryption version tracking for provider connection tokens
-- Enables key rotation for OAuth access and refresh tokens

ALTER TABLE provider_connections
ADD COLUMN access_token_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE provider_connections
ADD COLUMN refresh_token_version INTEGER;
