-- Performance indexes for common query patterns
-- This migration adds indexes to optimize frequently used queries

-- Secrets table indexes
-- Frequently queried by vault_id + environment (for pull/push operations)
CREATE INDEX IF NOT EXISTS idx_secrets_vault_environment ON secrets(vault_id, environment);

-- Frequently queried by vault_id + key (for upsert operations)
CREATE INDEX IF NOT EXISTS idx_secrets_vault_key ON secrets(vault_id, key);

-- Activity logs indexes
-- Frequently queried by user_id for user activity history
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);

-- Frequently queried by vault_id for vault activity
CREATE INDEX IF NOT EXISTS idx_activity_logs_vault_id ON activity_logs(vault_id);

-- Frequently queried by created_at for recent activity (DESC for latest first)
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- Composite index for user activity queries with time ordering
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs(user_id, created_at DESC);

-- Environment permissions indexes
-- Frequently queried by vault_id + environment
CREATE INDEX IF NOT EXISTS idx_env_permissions_vault_env ON environment_permissions(vault_id, environment);

-- Device codes indexes
-- Frequently queried by status for cleanup jobs
CREATE INDEX IF NOT EXISTS idx_device_codes_status ON device_codes(status);

-- Frequently queried by expires_at for expired code cleanup
CREATE INDEX IF NOT EXISTS idx_device_codes_expires_at ON device_codes(expires_at);

-- Vaults indexes
-- Frequently queried by owner_id for user's vaults list
CREATE INDEX IF NOT EXISTS idx_vaults_owner_id ON vaults(owner_id);
