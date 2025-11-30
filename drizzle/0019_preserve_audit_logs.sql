-- Preserve audit logs on user/vault deletion for compliance
-- Logs must be retained even after account deletion for security audits

-- Activity logs: change cascade to set null
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_users_id_fk;
ALTER TABLE activity_logs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE activity_logs ADD CONSTRAINT activity_logs_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Pull events: change cascade to set null
ALTER TABLE pull_events DROP CONSTRAINT IF EXISTS pull_events_user_id_users_id_fk;
ALTER TABLE pull_events DROP CONSTRAINT IF EXISTS pull_events_vault_id_vaults_id_fk;
ALTER TABLE pull_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE pull_events ALTER COLUMN vault_id DROP NOT NULL;
ALTER TABLE pull_events ADD CONSTRAINT pull_events_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pull_events ADD CONSTRAINT pull_events_vault_id_vaults_id_fk
  FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE SET NULL;

-- Security alerts: change cascade to set null
ALTER TABLE security_alerts DROP CONSTRAINT IF EXISTS security_alerts_user_id_users_id_fk;
ALTER TABLE security_alerts DROP CONSTRAINT IF EXISTS security_alerts_vault_id_vaults_id_fk;
ALTER TABLE security_alerts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE security_alerts ALTER COLUMN vault_id DROP NOT NULL;
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_vault_id_vaults_id_fk
  FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE SET NULL;
