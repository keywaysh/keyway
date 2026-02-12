-- Add secret_value_accessed to activity_action enum
-- Used for audit logging when users access secret values via the dashboard
ALTER TYPE "activity_action" ADD VALUE 'secret_value_accessed';
