import { db, secrets } from '../db';
import { eq, and, desc, count } from 'drizzle-orm';
import { getEncryptionService } from '../utils/encryption';

export interface SecretListItem {
  id: string;
  key: string;
  environment: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecretInput {
  vaultId: string;
  key: string;
  value: string;
  environment: string;
}

export interface UpdateSecretInput {
  key?: string;
  value?: string;
}

/**
 * Get all secrets for a vault (with optional pagination)
 */
export async function getSecretsForVault(
  vaultId: string,
  options?: { limit?: number; offset?: number }
): Promise<SecretListItem[]> {
  const queryOptions: any = {
    where: eq(secrets.vaultId, vaultId),
    orderBy: [desc(secrets.updatedAt)],
  };

  if (options?.limit !== undefined) {
    queryOptions.limit = options.limit;
  }
  if (options?.offset !== undefined) {
    queryOptions.offset = options.offset;
  }

  const vaultSecrets = await db.query.secrets.findMany(queryOptions);

  return vaultSecrets.map((secret) => ({
    id: secret.id,
    key: secret.key,
    environment: secret.environment,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
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

  // Check if secret already exists for this key+environment
  const existingSecret = await db.query.secrets.findFirst({
    where: and(
      eq(secrets.vaultId, input.vaultId),
      eq(secrets.key, input.key),
      eq(secrets.environment, input.environment)
    ),
  });

  if (existingSecret) {
    await db
      .update(secrets)
      .set({
        encryptedValue: encryptedData.encryptedContent,
        iv: encryptedData.iv,
        authTag: encryptedData.authTag,
        updatedAt: new Date(),
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
    })
    .returning();

  return { id: newSecret.id, status: 'created' };
}

/**
 * Update a secret by ID
 */
export async function updateSecret(
  secretId: string,
  vaultId: string,
  input: UpdateSecretInput
): Promise<SecretListItem | null> {
  // Get existing secret
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId)),
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
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
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
  }

  await db.update(secrets).set(updateData).where(eq(secrets.id, secretId));

  // Return updated secret
  const updatedSecret = await db.query.secrets.findFirst({
    where: eq(secrets.id, secretId),
  });

  if (!updatedSecret) return null;

  return {
    id: updatedSecret.id,
    key: updatedSecret.key,
    environment: updatedSecret.environment,
    createdAt: updatedSecret.createdAt.toISOString(),
    updatedAt: updatedSecret.updatedAt.toISOString(),
  };
}

/**
 * Delete a secret by ID
 */
export async function deleteSecret(
  secretId: string,
  vaultId: string
): Promise<{ key: string; environment: string } | null> {
  // Get secret first for return value
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId)),
  });

  if (!secret) {
    return null;
  }

  await db.delete(secrets).where(eq(secrets.id, secretId));

  return { key: secret.key, environment: secret.environment };
}

/**
 * Get a single secret by ID
 */
export async function getSecretById(
  secretId: string,
  vaultId: string
): Promise<SecretListItem | null> {
  const secret = await db.query.secrets.findFirst({
    where: and(eq(secrets.id, secretId), eq(secrets.vaultId, vaultId)),
  });

  if (!secret) return null;

  return {
    id: secret.id,
    key: secret.key,
    environment: secret.environment,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
  };
}

/**
 * Get total count of secrets for a vault
 */
export async function getSecretsCount(vaultId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(secrets)
    .where(eq(secrets.vaultId, vaultId));

  return result[0]?.count ?? 0;
}
