import { db, secrets } from '../db';
import { eq, and, desc, count, isNull, isNotNull, lt, inArray } from 'drizzle-orm';
import { getEncryptionService } from '../utils/encryption';

// Trash retention period in days
const TRASH_RETENTION_DAYS = 30;

export interface SecretListItem {
  id: string;
  key: string;
  environment: string;
  createdAt: string;
  updatedAt: string;
  lastModifiedBy: {
    username: string;
    avatarUrl: string | null;
  } | null;
}

export interface CreateSecretInput {
  vaultId: string;
  key: string;
  value: string;
  environment: string;
  userId?: string;
}

export interface UpdateSecretInput {
  key?: string;
  value?: string;
  userId?: string;
}

/**
 * Get all active secrets for a vault (excludes trashed)
 */
export async function getSecretsForVault(
  vaultId: string,
  options?: { limit?: number; offset?: number }
): Promise<SecretListItem[]> {
  const vaultSecrets = await db.query.secrets.findMany({
    where: and(eq(secrets.vaultId, vaultId), isNull(secrets.deletedAt)),
    orderBy: [desc(secrets.updatedAt)],
    with: {
      lastModifiedBy: true,
    },
    limit: options?.limit,
    offset: options?.offset,
  });

  return vaultSecrets.map((secret) => ({
    id: secret.id,
    key: secret.key,
    environment: secret.environment,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
    lastModifiedBy: secret.lastModifiedBy
      ? {
          username: secret.lastModifiedBy.username,
          avatarUrl: secret.lastModifiedBy.avatarUrl,
        }
      : null,
  }));
}

/**
 * Create or update a secret (upsert by key+environment)
 */
export async function upsertSecret(
  input: CreateSecretInput
): Promise<{ id: string; status: 'created' | 'updated' }> {
  const encryptionService = await getEncryptionService();
  const encryptedData = await encryptionService.encrypt(input.value);

  // Check if active secret already exists for this key+environment (excludes trashed)
  const existingSecret = await db.query.secrets.findFirst({
    where: and(
      eq(secrets.vaultId, input.vaultId),
      eq(secrets.key, input.key),
      eq(secrets.environment, input.environment),
      isNull(secrets.deletedAt)
    ),
  });

  if (existingSecret) {
    await db
      .update(secrets)
      .set({
        encryptedValue: encryptedData.encryptedContent,
        iv: encryptedData.iv,
        authTag: encryptedData.authTag,
        encryptionVersion: encryptedData.version ?? 1,
        updatedAt: new Date(),
        lastModifiedById: input.userId ?? null,
      })
      .where(eq(secrets.id, existingSecret.id));

    return { id: existingSecret.id, status: 'updated' };
  }

  const [newSecret] = await db
    .insert(secrets)
    .values({
      vaultId: input.vaultId,
      key: input.key,
      environment: input.environment,
      encryptedValue: encryptedData.encryptedContent,
      iv: encryptedData.iv,
      authTag: encryptedData.authTag,
      encryptionVersion: encryptedData.version ?? 1,
      lastModifiedById: input.userId ?? null,
    })
    .returning();

  return { id: newSecret.id, status: 'created' };
}

/**
 * Update a secret by ID (only active secrets)
 */
export async function updateSecret(
  secretId: string,
  vaultId: string,
  input: UpdateSecretInput
): Promise<SecretListItem | null> {
  // Get existing active secret
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId), isNull(secrets.deletedAt)),
  });

  if (!secret) {
    return null;
  }

  // Build update object
  const updateData: {
    key?: string;
    encryptedValue?: string;
    iv?: string;
    authTag?: string;
    encryptionVersion?: number;
    updatedAt: Date;
    lastModifiedById?: string | null;
  } = {
    updatedAt: new Date(),
    lastModifiedById: input.userId ?? null,
  };

  if (input.key) {
    updateData.key = input.key;
  }

  if (input.value) {
    const encryptionService = await getEncryptionService();
    const encryptedData = await encryptionService.encrypt(input.value);
    updateData.encryptedValue = encryptedData.encryptedContent;
    updateData.iv = encryptedData.iv;
    updateData.authTag = encryptedData.authTag;
    updateData.encryptionVersion = encryptedData.version ?? 1;
  }

  await db.update(secrets).set(updateData).where(eq(secrets.id, secretId));

  // Return updated secret with lastModifiedBy
  const updatedSecret = await db.query.secrets.findFirst({
    where: eq(secrets.id, secretId),
    with: {
      lastModifiedBy: true,
    },
  });

  if (!updatedSecret) return null;

  return {
    id: updatedSecret.id,
    key: updatedSecret.key,
    environment: updatedSecret.environment,
    createdAt: updatedSecret.createdAt.toISOString(),
    updatedAt: updatedSecret.updatedAt.toISOString(),
    lastModifiedBy: updatedSecret.lastModifiedBy
      ? {
          username: updatedSecret.lastModifiedBy.username,
          avatarUrl: updatedSecret.lastModifiedBy.avatarUrl,
        }
      : null,
  };
}

/**
 * Soft-delete a secret (move to trash)
 * Returns info for undo/activity logging
 */
export async function trashSecret(
  secretId: string,
  vaultId: string
): Promise<{ key: string; environment: string; deletedAt: Date; expiresAt: Date } | null> {
  // Get active secret
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId), isNull(secrets.deletedAt)),
  });

  if (!secret) {
    return null;
  }

  const deletedAt = new Date();
  const expiresAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  await db
    .update(secrets)
    .set({ deletedAt })
    .where(eq(secrets.id, secretId));

  return { key: secret.key, environment: secret.environment, deletedAt, expiresAt };
}

/**
 * Bulk soft-delete secrets by IDs (move to trash)
 * Used by push operation when secrets are removed from .env file
 */
export async function trashSecretsByIds(secretIds: string[]): Promise<void> {
  if (secretIds.length === 0) return;

  await db
    .update(secrets)
    .set({ deletedAt: new Date() })
    .where(inArray(secrets.id, secretIds));
}

/**
 * Permanently delete a secret (hard delete)
 * Used for permanent deletion from trash
 */
export async function permanentlyDeleteSecret(
  secretId: string,
  vaultId: string
): Promise<{ key: string; environment: string } | null> {
  // Get trashed secret
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId), isNotNull(secrets.deletedAt)),
  });

  if (!secret) {
    return null;
  }

  await db.delete(secrets).where(eq(secrets.id, secretId));

  return { key: secret.key, environment: secret.environment };
}

/**
 * Get a single active secret by ID
 */
export async function getSecretById(
  secretId: string,
  vaultId: string
): Promise<SecretListItem | null> {
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId), isNull(secrets.deletedAt)),
    with: {
      lastModifiedBy: true,
    },
  });

  if (!secret) return null;

  return {
    id: secret.id,
    key: secret.key,
    environment: secret.environment,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
    lastModifiedBy: secret.lastModifiedBy
      ? {
          username: secret.lastModifiedBy.username,
          avatarUrl: secret.lastModifiedBy.avatarUrl,
        }
      : null,
  };
}

/**
 * Get total count of active secrets for a vault (excludes trashed)
 */
export async function getSecretsCount(vaultId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(secrets)
    .where(and(eq(secrets.vaultId, vaultId), isNull(secrets.deletedAt)));

  return result[0]?.count ?? 0;
}

/**
 * Check if an active secret exists by key+environment (for limit checking before upsert)
 */
export async function secretExists(
  vaultId: string,
  key: string,
  environment: string
): Promise<boolean> {
  const existing = await db.query.secrets.findFirst({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.key, key),
      eq(secrets.environment, environment),
      isNull(secrets.deletedAt)
    ),
  });
  return !!existing;
}

/**
 * Generate a preview of a secret value (first 4 + •••• + last 4 chars)
 * Never reveals the full value - for security display purposes
 */
export function generatePreview(value: string): string {
  if (value.length <= 8) return '••••••••';
  if (value.length <= 12) return `${value.slice(0, 2)}••••${value.slice(-2)}`;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/**
 * Get an active secret's decrypted value and preview by ID
 * Used for secure reveal feature in dashboard
 */
export async function getSecretValue(
  secretId: string,
  vaultId: string
): Promise<{ value: string; preview: string; key: string; environment: string } | null> {
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId), isNull(secrets.deletedAt)),
  });

  if (!secret) return null;

  const encryptionService = await getEncryptionService();
  const decryptedValue = await encryptionService.decrypt({
    encryptedContent: secret.encryptedValue,
    iv: secret.iv,
    authTag: secret.authTag,
    version: secret.encryptionVersion ?? 1,
  });

  return {
    value: decryptedValue,
    preview: generatePreview(decryptedValue),
    key: secret.key,
    environment: secret.environment,
  };
}

// ============================================
// Trash operations
// ============================================

export interface TrashedSecretItem {
  id: string;
  key: string;
  environment: string;
  deletedAt: string;
  expiresAt: string;
  daysRemaining: number;
}

/**
 * Get all trashed secrets for a vault
 */
export async function getTrashedSecrets(
  vaultId: string,
  options?: { limit?: number; offset?: number }
): Promise<TrashedSecretItem[]> {
  const queryOptions: any = {
    where: and(eq(secrets.vaultId, vaultId), isNotNull(secrets.deletedAt)),
    orderBy: [desc(secrets.deletedAt)],
  };

  if (options?.limit !== undefined) {
    queryOptions.limit = options.limit;
  }
  if (options?.offset !== undefined) {
    queryOptions.offset = options.offset;
  }

  const trashedSecrets = await db.query.secrets.findMany(queryOptions);

  return trashedSecrets.map((secret) => {
    const deletedAt = secret.deletedAt!;
    const expiresAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

    return {
      id: secret.id,
      key: secret.key,
      environment: secret.environment,
      deletedAt: deletedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      daysRemaining,
    };
  });
}

/**
 * Get count of trashed secrets for a vault
 */
export async function getTrashedSecretsCount(vaultId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(secrets)
    .where(and(eq(secrets.vaultId, vaultId), isNotNull(secrets.deletedAt)));

  return result[0]?.count ?? 0;
}

/**
 * Restore a secret from trash
 * Returns null if secret not found or not in trash
 * Throws error if key+environment already exists
 */
export async function restoreSecret(
  secretId: string,
  vaultId: string
): Promise<{ id: string; key: string; environment: string } | null> {
  // Get trashed secret
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId), isNotNull(secrets.deletedAt)),
  });

  if (!secret) {
    return null;
  }

  // Check if key+environment already exists (conflict)
  const existingActive = await db.query.secrets.findFirst({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.key, secret.key),
      eq(secrets.environment, secret.environment),
      isNull(secrets.deletedAt)
    ),
  });

  if (existingActive) {
    throw new Error(`Secret "${secret.key}" already exists in ${secret.environment}`);
  }

  // Restore by clearing deletedAt
  await db
    .update(secrets)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(secrets.id, secretId));

  return { id: secret.id, key: secret.key, environment: secret.environment };
}

/**
 * Empty all trash for a vault (permanent delete all trashed secrets)
 */
export async function emptyTrash(vaultId: string): Promise<{ deleted: number; keys: string[] }> {
  // Get all trashed secrets first for return value
  const trashed = await db.query.secrets.findMany({
    where: and(eq(secrets.vaultId, vaultId), isNotNull(secrets.deletedAt)),
  });

  if (trashed.length === 0) {
    return { deleted: 0, keys: [] };
  }

  await db
    .delete(secrets)
    .where(and(eq(secrets.vaultId, vaultId), isNotNull(secrets.deletedAt)));

  return {
    deleted: trashed.length,
    keys: trashed.map((s) => s.key),
  };
}

/**
 * Purge expired trash (secrets deleted more than TRASH_RETENTION_DAYS ago)
 * Used by background cron job
 */
export async function purgeExpiredTrash(): Promise<{ purged: number }> {
  const expirationThreshold = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(secrets)
    .where(and(isNotNull(secrets.deletedAt), lt(secrets.deletedAt, expirationThreshold)))
    .returning({ id: secrets.id });

  return { purged: result.length };
}
