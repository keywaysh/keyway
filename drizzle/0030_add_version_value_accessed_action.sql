-- Add secret_version_value_accessed action to activity_action enum
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'secret_version_value_accessed';
