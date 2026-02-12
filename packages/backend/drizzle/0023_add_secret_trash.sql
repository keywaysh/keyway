-- Add deletedAt column for soft-delete functionality (trash/recycle bin)
ALTER TABLE secrets ADD COLUMN deleted_at TIMESTAMP;

-- Add partial index for efficient trash queries (only index non-null values)
CREATE INDEX idx_secrets_deleted_at ON secrets(deleted_at) WHERE deleted_at IS NOT NULL;

-- Add new activity action types for trash operations
ALTER TYPE activity_action ADD VALUE 'secret_trashed';
ALTER TYPE activity_action ADD VALUE 'secret_restored';
ALTER TYPE activity_action ADD VALUE 'secret_permanently_deleted';
