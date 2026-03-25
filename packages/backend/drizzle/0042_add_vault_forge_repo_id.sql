ALTER TABLE "vaults" ADD COLUMN "forge_repo_id" text;
CREATE UNIQUE INDEX "idx_vaults_forge_repo_id_unique"
  ON "vaults" ("forge_type", "forge_repo_id")
  WHERE "forge_repo_id" IS NOT NULL;
