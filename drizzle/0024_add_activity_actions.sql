-- Add new activity action types for comprehensive audit logging

-- Integration actions
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'integration_connected';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'integration_disconnected';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'secrets_synced';

-- Billing actions
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'plan_upgraded';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'plan_downgraded';

-- GitHub App actions
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'github_app_installed';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'github_app_uninstalled';

-- Auth actions
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'user_login';
