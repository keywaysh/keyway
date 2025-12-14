-- Add last_modified_by_id to secrets table to track who last modified a secret
ALTER TABLE "secrets" ADD COLUMN "last_modified_by_id" uuid;

-- Add foreign key constraint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_last_modified_by_id_users_id_fk"
  FOREIGN KEY ("last_modified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
