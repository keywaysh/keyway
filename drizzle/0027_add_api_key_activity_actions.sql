-- Add API key activity actions to enum

ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'api_key_created';
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'api_key_revoked';
