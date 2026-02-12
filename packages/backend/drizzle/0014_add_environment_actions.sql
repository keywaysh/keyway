-- Migration: Add environment actions to activity_action enum
-- Created: 2025-11-28

-- Add new enum values for environment CRUD operations
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'environment_created';
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'environment_renamed';
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'environment_deleted';
