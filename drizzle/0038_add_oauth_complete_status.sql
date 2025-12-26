-- Add oauth_complete status to device_code_status enum
ALTER TYPE "device_code_status" ADD VALUE 'oauth_complete';

-- Add deep linking columns to device_codes table
ALTER TABLE "device_codes" ADD COLUMN "suggested_owner_id" integer;
ALTER TABLE "device_codes" ADD COLUMN "suggested_repo_id" integer;
