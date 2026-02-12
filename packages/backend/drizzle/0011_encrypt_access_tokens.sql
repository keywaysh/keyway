-- Migration: Encrypt GitHub access tokens at rest
-- This is a BREAKING migration - existing tokens will be lost and users need to re-authenticate

-- Step 1: Add new encrypted columns
ALTER TABLE "users" ADD COLUMN "encrypted_access_token" text;
ALTER TABLE "users" ADD COLUMN "access_token_iv" text;
ALTER TABLE "users" ADD COLUMN "access_token_auth_tag" text;

-- Step 2: Drop old plaintext column
ALTER TABLE "users" DROP COLUMN "access_token";

-- Step 3: Make new columns NOT NULL (after dropping old column)
ALTER TABLE "users" ALTER COLUMN "encrypted_access_token" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "access_token_iv" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "access_token_auth_tag" SET NOT NULL;
