import { db, secrets, secretVersions, type DbExecutor } from "../db";
import { eq, and, desc, inArray, isNull, max, sql } from "drizzle-orm";
import { getEncryptionService } from "../utils/encryption";

// Maximum number of versions to keep per secret
const MAX_VERSIONS_PER_SECRET = 10;

export interface SecretVersionItem {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdBy: {
    username: string;
    avatarUrl: string | null;
  } | null;
}

/**
 * Save the current secret value as a version before updating.
 * Called internally by upsertSecret and updateSecret when value changes.
 */
export async function saveSecretVersion(
  secretId: string,
  vaultId: string,
  encryptedValue: string,
  iv: string,
  authTag: string,
  encryptionVersion: number,
  userId?: string,
  executor: DbExecutor = db
): Promise<void> {
  // Get current max version number for this secret
  const existingVersions = await executor
    .select({ versionNumber: secretVersions.versionNumber })
    .from(secretVersions)
    .where(eq(secretVersions.secretId, secretId))
    .orderBy(desc(secretVersions.versionNumber))
    .limit(1);

  const nextVersion = (existingVersions[0]?.versionNumber ?? 0) + 1;

  // Insert new version
  await executor.insert(secretVersions).values({
    secretId,
    vaultId,
    versionNumber: nextVersion,
    encryptedValue,
    iv,
    authTag,
    encryptionVersion,
    createdById: userId ?? null,
  });

  // Prune old versions if > MAX_VERSIONS_PER_SECRET
  await pruneOldVersions(secretId, executor);
}

export interface SecretVersionToSave {
  secretId: string;
  vaultId: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  encryptionVersion: number;
}

/**
 * Save the current values of several secrets as versions before updating them, in three
 * queries whatever the count (numbering, insert, pruning).
 */
export async function saveSecretVersions(
  entries: SecretVersionToSave[],
  userId?: string,
  executor: DbExecutor = db
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const secretIds = entries.map((entry) => entry.secretId);

  const latest = await executor
    .select({ secretId: secretVersions.secretId, versionNumber: max(secretVersions.versionNumber) })
    .from(secretVersions)
    .where(inArray(secretVersions.secretId, secretIds))
    .groupBy(secretVersions.secretId);
  const latestById = new Map(latest.map((row) => [row.secretId, row.versionNumber ?? 0]));

  await executor.insert(secretVersions).values(
    entries.map((entry) => ({
      ...entry,
      versionNumber: (latestById.get(entry.secretId) ?? 0) + 1,
      createdById: userId ?? null,
    }))
  );

  // Keep the MAX_VERSIONS_PER_SECRET most recent versions of each secret
  await executor.execute(sql`
    DELETE FROM ${secretVersions}
    WHERE ${secretVersions.id} IN (
      SELECT id FROM (
        SELECT ${secretVersions.id} AS id,
          row_number() OVER (
            PARTITION BY ${secretVersions.secretId} ORDER BY ${secretVersions.versionNumber} DESC
          ) AS rank
        FROM ${secretVersions}
        WHERE ${inArray(secretVersions.secretId, secretIds)}
      ) ranked
      WHERE rank > ${MAX_VERSIONS_PER_SECRET}
    )
  `);
}

/**
 * Remove oldest versions if count exceeds MAX_VERSIONS_PER_SECRET
 */
async function pruneOldVersions(secretId: string, executor: DbExecutor): Promise<void> {
  // Get all versions ordered by version number desc
  const versions = await executor
    .select({ id: secretVersions.id, versionNumber: secretVersions.versionNumber })
    .from(secretVersions)
    .where(eq(secretVersions.secretId, secretId))
    .orderBy(desc(secretVersions.versionNumber));

  if (versions.length > MAX_VERSIONS_PER_SECRET) {
    const idsToDelete = versions.slice(MAX_VERSIONS_PER_SECRET).map((v) => v.id);

    if (idsToDelete.length > 0) {
      await executor.delete(secretVersions).where(inArray(secretVersions.id, idsToDelete));
    }
  }
}

/**
 * Get version history for a secret (metadata only, no values)
 */
export async function getSecretVersions(
  secretId: string,
  vaultId: string
): Promise<SecretVersionItem[]> {
  const versions = await db.query.secretVersions.findMany({
    where: and(eq(secretVersions.secretId, secretId), eq(secretVersions.vaultId, vaultId)),
    orderBy: [desc(secretVersions.versionNumber)],
    with: {
      createdBy: true,
    },
  });

  return versions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    createdAt: v.createdAt.toISOString(),
    createdBy: v.createdBy
      ? {
          username: v.createdBy.username,
          avatarUrl: v.createdBy.avatarUrl,
        }
      : null,
  }));
}

/**
 * Get a specific version's decrypted value
 */
export async function getSecretVersionValue(
  versionId: string,
  secretId: string,
  vaultId: string
): Promise<{ value: string; versionNumber: number } | null> {
  const version = await db.query.secretVersions.findFirst({
    where: and(
      eq(secretVersions.id, versionId),
      eq(secretVersions.secretId, secretId),
      eq(secretVersions.vaultId, vaultId)
    ),
  });

  if (!version) {
    return null;
  }

  const encryptionService = await getEncryptionService();
  const decryptedValue = await encryptionService.decrypt({
    encryptedContent: version.encryptedValue,
    iv: version.iv,
    authTag: version.authTag,
    version: version.encryptionVersion ?? 1,
  });

  return {
    value: decryptedValue,
    versionNumber: version.versionNumber,
  };
}

/**
 * Restore a secret to a previous version.
 * This updates the current secret with the old value and creates a new version entry
 * for the current value before restoring.
 */
export async function restoreSecretVersion(
  versionId: string,
  secretId: string,
  vaultId: string,
  userId?: string
): Promise<{ key: string; versionNumber: number } | null> {
  // Get the version to restore
  const versionToRestore = await db.query.secretVersions.findFirst({
    where: and(
      eq(secretVersions.id, versionId),
      eq(secretVersions.secretId, secretId),
      eq(secretVersions.vaultId, vaultId)
    ),
  });

  if (!versionToRestore) {
    return null;
  }

  // Get current active secret (not trashed)
  const currentSecret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), isNull(secrets.deletedAt)),
  });

  if (!currentSecret) {
    return null;
  }

  // Save current value as a new version before restoring
  await saveSecretVersion(
    secretId,
    vaultId,
    currentSecret.encryptedValue,
    currentSecret.iv,
    currentSecret.authTag,
    currentSecret.encryptionVersion,
    userId
  );

  // Update secret with restored version's value
  await db
    .update(secrets)
    .set({
      encryptedValue: versionToRestore.encryptedValue,
      iv: versionToRestore.iv,
      authTag: versionToRestore.authTag,
      encryptionVersion: versionToRestore.encryptionVersion,
      updatedAt: new Date(),
      lastModifiedById: userId ?? null,
    })
    .where(eq(secrets.id, secretId));

  return {
    key: currentSecret.key,
    versionNumber: versionToRestore.versionNumber,
  };
}
