ALTER TABLE "vaults" ADD COLUMN "forge_repo_id" text;
CREATE INDEX "idx_vaults_forge_repo_id" ON "vaults" ("forge_repo_id") WHERE "forge_repo_id" IS NOT NULL;
