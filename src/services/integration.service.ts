/**
 * Integration Service
 * Handles provider connections and sync operations
 */

import { eq, and } from 'drizzle-orm';
import { db, providerConnections, vaultSyncs, syncLogs, secrets, vaults } from '../db';
import { getProvider } from './providers';
import { getEncryptionService, type EncryptedData } from '../utils/encryption';
import type { SyncDirection, SyncStatus } from '../db/schema';

// Types
export interface ConnectionInfo {
  id: string;
  provider: string;
  providerUserId: string | null;
  providerTeamId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncPreview {
  toCreate: string[];
  toUpdate: string[];
  toDelete: string[];
  toSkip: string[];
}

export interface SyncResult {
  status: SyncStatus;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  error?: string;
}

export interface SyncStatusInfo {
  isFirstSync: boolean;
  vaultIsEmpty: boolean;
  providerHasSecrets: boolean;
  providerSecretCount: number;
}

// Helper to encrypt provider token
async function encryptProviderToken(token: string) {
  const encryptionService = await getEncryptionService();
  const encrypted = await encryptionService.encrypt(token);
  return {
    encryptedAccessToken: encrypted.encryptedContent,
    accessTokenIv: encrypted.iv,
    accessTokenAuthTag: encrypted.authTag,
  };
}

// Helper to decrypt provider token
async function decryptProviderToken(connection: {
  encryptedAccessToken: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
}): Promise<string> {
  const encryptionService = await getEncryptionService();
  return encryptionService.decrypt({
    encryptedContent: connection.encryptedAccessToken,
    iv: connection.accessTokenIv,
    authTag: connection.accessTokenAuthTag,
  });
}

// Helper to decrypt provider refresh token
async function decryptProviderRefreshToken(connection: {
  encryptedRefreshToken: string | null;
  refreshTokenIv: string | null;
  refreshTokenAuthTag: string | null;
}): Promise<string | null> {
  if (!connection.encryptedRefreshToken || !connection.refreshTokenIv || !connection.refreshTokenAuthTag) {
    return null;
  }
  const encryptionService = await getEncryptionService();
  return encryptionService.decrypt({
    encryptedContent: connection.encryptedRefreshToken,
    iv: connection.refreshTokenIv,
    authTag: connection.refreshTokenAuthTag,
  });
}

/**
 * Safely decrypt a secret value, returning null if decryption fails
 * This prevents one corrupted secret from crashing entire sync operations
 */
async function safeDecryptSecret(secret: {
  encryptedValue: string;
  iv: string;
  authTag: string;
  key: string;
}): Promise<{ key: string; value: string } | null> {
  try {
    const encryptionService = await getEncryptionService();
    const value = await encryptionService.decrypt({
      encryptedContent: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
    });
    return { key: secret.key, value };
  } catch (error) {
    console.error(`[IntegrationService] Failed to decrypt secret '${secret.key}': ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

// Type for connection with all token fields
type ConnectionWithTokens = {
  id: string;
  provider: string;
  providerTeamId: string | null;
  encryptedAccessToken: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
  encryptedRefreshToken: string | null;
  refreshTokenIv: string | null;
  refreshTokenAuthTag: string | null;
  tokenExpiresAt: Date | null;
};

/**
 * Get valid access token, refreshing if expired
 */
async function getValidAccessToken(connection: ConnectionWithTokens): Promise<string> {
  // Check if token is expired
  if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
    const provider = getProvider(connection.provider);
    const refreshToken = await decryptProviderRefreshToken(connection);

    if (provider?.refreshToken && refreshToken) {
      try {
        const newTokens = await provider.refreshToken(refreshToken);

        // Update connection with new tokens
        const encrypted = await encryptProviderToken(newTokens.accessToken);
        await db
          .update(providerConnections)
          .set({
            ...encrypted,
            tokenExpiresAt: newTokens.expiresIn
              ? new Date(Date.now() + newTokens.expiresIn * 1000)
              : null,
            updatedAt: new Date(),
          })
          .where(eq(providerConnections.id, connection.id));

        return newTokens.accessToken;
      } catch {
        throw new Error('Token expired and refresh failed. Please reconnect to provider.');
      }
    }

    throw new Error('Token expired. Please reconnect to provider.');
  }

  return decryptProviderToken(connection);
}

/**
 * Get a user's connection to a provider
 */
export async function getConnection(
  userId: string,
  providerName: string,
  teamId?: string
): Promise<ConnectionInfo | null> {
  const conditions = [
    eq(providerConnections.userId, userId),
    eq(providerConnections.provider, providerName),
  ];

  if (teamId) {
    conditions.push(eq(providerConnections.providerTeamId, teamId));
  }

  const connection = await db.query.providerConnections.findFirst({
    where: and(...conditions),
  });

  if (!connection) return null;

  return {
    id: connection.id,
    provider: connection.provider,
    providerUserId: connection.providerUserId,
    providerTeamId: connection.providerTeamId,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

/**
 * List all connections for a user
 */
export async function listConnections(userId: string): Promise<ConnectionInfo[]> {
  const connections = await db.query.providerConnections.findMany({
    where: eq(providerConnections.userId, userId),
  });

  return connections.map(c => ({
    id: c.id,
    provider: c.provider,
    providerUserId: c.providerUserId,
    providerTeamId: c.providerTeamId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

/**
 * Store a new provider connection after OAuth
 */
export async function createConnection(
  userId: string,
  providerName: string,
  accessToken: string,
  providerUser: { id: string; teamId?: string },
  refreshToken?: string,
  expiresAt?: Date,
  scopes?: string[]
) {
  const encrypted = await encryptProviderToken(accessToken);

  let refreshTokenData = {};
  if (refreshToken) {
    const encryptionService = await getEncryptionService();
    const encryptedRefresh = await encryptionService.encrypt(refreshToken);
    refreshTokenData = {
      encryptedRefreshToken: encryptedRefresh.encryptedContent,
      refreshTokenIv: encryptedRefresh.iv,
      refreshTokenAuthTag: encryptedRefresh.authTag,
    };
  }

  const [connection] = await db
    .insert(providerConnections)
    .values({
      userId,
      provider: providerName,
      providerUserId: providerUser.id,
      providerTeamId: providerUser.teamId || null,
      ...encrypted,
      ...refreshTokenData,
      tokenExpiresAt: expiresAt || null,
      scopes: scopes || null,
    })
    .onConflictDoUpdate({
      target: [providerConnections.userId, providerConnections.provider, providerConnections.providerTeamId],
      set: {
        ...encrypted,
        ...refreshTokenData,
        providerUserId: providerUser.id,
        tokenExpiresAt: expiresAt || null,
        scopes: scopes || null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return connection;
}

/**
 * Delete a provider connection
 */
export async function deleteConnection(userId: string, connectionId: string): Promise<boolean> {
  const result = await db
    .delete(providerConnections)
    .where(and(
      eq(providerConnections.id, connectionId),
      eq(providerConnections.userId, userId)
    ))
    .returning({ id: providerConnections.id });

  return result.length > 0;
}

/**
 * Get decrypted access token for a connection
 */
export async function getConnectionToken(connectionId: string): Promise<string | null> {
  const connection = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.id, connectionId),
  });

  if (!connection) return null;

  return decryptProviderToken(connection);
}

/**
 * List provider projects for a connection
 * Requires userId for ownership validation
 */
export async function listProviderProjects(connectionId: string, userId: string) {
  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(
      eq(providerConnections.id, connectionId),
      eq(providerConnections.userId, userId)
    ),
  });

  if (!connection) {
    throw new Error('Connection not found');
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  const accessToken = await getValidAccessToken(connection);
  return provider.listProjects(accessToken, connection.providerTeamId || undefined);
}

/**
 * Get sync status (for first-time detection)
 * Requires userId for ownership validation
 */
export async function getSyncStatus(
  vaultId: string,
  connectionId: string,
  projectId: string,
  environment: string,
  userId: string
): Promise<SyncStatusInfo> {
  // Batch queries for better performance, including ownership check
  const [existingSync, vaultSecrets, connection] = await Promise.all([
    // Check if there's been a previous sync
    db.query.vaultSyncs.findFirst({
      where: and(
        eq(vaultSyncs.vaultId, vaultId),
        eq(vaultSyncs.connectionId, connectionId),
        eq(vaultSyncs.providerProjectId, projectId)
      ),
    }),
    // Check if vault has secrets
    db.query.secrets.findMany({
      where: and(
        eq(secrets.vaultId, vaultId),
        eq(secrets.environment, environment)
      ),
    }),
    // Get connection for provider access (with ownership validation)
    db.query.providerConnections.findFirst({
      where: and(
        eq(providerConnections.id, connectionId),
        eq(providerConnections.userId, userId)
      ),
    }),
  ]);

  if (!connection) {
    throw new Error('Connection not found');
  }

  let providerSecretCount = 0;
  const provider = getProvider(connection.provider);
  if (provider) {
    const accessToken = await getValidAccessToken(connection);
    const providerEnvVars = await provider.listEnvVars(
      accessToken,
      projectId,
      environment,
      connection.providerTeamId || undefined
    );
    providerSecretCount = providerEnvVars.length;
  }

  return {
    isFirstSync: !existingSync,
    vaultIsEmpty: vaultSecrets.length === 0,
    providerHasSecrets: providerSecretCount > 0,
    providerSecretCount,
  };
}

/**
 * Get sync preview (what would change)
 * Requires userId for ownership validation
 */
export async function getSyncPreview(
  vaultId: string,
  connectionId: string,
  projectId: string,
  keywayEnvironment: string,
  providerEnvironment: string,
  direction: SyncDirection,
  allowDelete: boolean,
  userId: string
): Promise<SyncPreview> {
  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(
      eq(providerConnections.id, connectionId),
      eq(providerConnections.userId, userId)
    ),
  });

  if (!connection) {
    throw new Error('Connection not found');
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  const accessToken = await getValidAccessToken(connection);

  // Get Keyway secrets
  const keywaySecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment)
    ),
  });

  const keywaySecretsMap = new Map<string, string>();
  const decryptionErrors: string[] = [];
  for (const secret of keywaySecrets) {
    const decrypted = await safeDecryptSecret(secret);
    if (decrypted) {
      keywaySecretsMap.set(decrypted.key, decrypted.value);
    } else {
      decryptionErrors.push(secret.key);
    }
  }

  // Log if there were decryption errors but continue with available secrets
  if (decryptionErrors.length > 0) {
    console.warn(`[IntegrationService] Skipped ${decryptionErrors.length} secrets due to decryption errors: ${decryptionErrors.join(', ')}`);
  }

  // Get provider secrets
  const providerEnvVars = await provider.listEnvVars(
    accessToken,
    projectId,
    providerEnvironment,
    connection.providerTeamId || undefined
  );

  const providerSecretsMap = new Map<string, string>();
  for (const envVar of providerEnvVars) {
    if (envVar.value) {
      providerSecretsMap.set(envVar.key, envVar.value);
    }
  }

  const toCreate: string[] = [];
  const toUpdate: string[] = [];
  const toDelete: string[] = [];
  const toSkip: string[] = [];

  if (direction === 'push') {
    // Keyway → Provider
    for (const [key, value] of keywaySecretsMap) {
      const providerValue = providerSecretsMap.get(key);
      if (providerValue === undefined) {
        toCreate.push(key);
      } else if (providerValue !== value) {
        toUpdate.push(key);
      } else {
        toSkip.push(key);
      }
    }

    if (allowDelete) {
      for (const key of providerSecretsMap.keys()) {
        if (!keywaySecretsMap.has(key)) {
          toDelete.push(key);
        }
      }
    }
  } else {
    // Provider → Keyway (pull/import)
    for (const [key, value] of providerSecretsMap) {
      const keywayValue = keywaySecretsMap.get(key);
      if (keywayValue === undefined) {
        toCreate.push(key);
      } else if (keywayValue !== value) {
        // For import, we skip existing by default
        toSkip.push(key);
      } else {
        toSkip.push(key);
      }
    }
  }

  return { toCreate, toUpdate, toDelete, toSkip };
}

/**
 * Execute a sync operation
 * Requires triggeredBy (userId) for ownership validation
 */
export async function executeSync(
  vaultId: string,
  connectionId: string,
  projectId: string,
  keywayEnvironment: string,
  providerEnvironment: string,
  direction: SyncDirection,
  allowDelete: boolean,
  triggeredBy: string
): Promise<SyncResult> {
  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(
      eq(providerConnections.id, connectionId),
      eq(providerConnections.userId, triggeredBy)
    ),
  });

  if (!connection) {
    throw new Error('Connection not found');
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  const accessToken = await getValidAccessToken(connection);

  // Get or create vault sync config
  let syncConfig = await db.query.vaultSyncs.findFirst({
    where: and(
      eq(vaultSyncs.vaultId, vaultId),
      eq(vaultSyncs.connectionId, connectionId),
      eq(vaultSyncs.providerProjectId, projectId),
      eq(vaultSyncs.providerEnvironment, providerEnvironment)
    ),
  });

  if (!syncConfig) {
    // Get project name
    let projectName: string | undefined;
    if (provider.getProject) {
      const project = await provider.getProject(accessToken, projectId, connection.providerTeamId || undefined);
      projectName = project?.name;
    }

    [syncConfig] = await db
      .insert(vaultSyncs)
      .values({
        vaultId,
        connectionId,
        provider: connection.provider,
        providerProjectId: projectId,
        providerProjectName: projectName,
        keywayEnvironment,
        providerEnvironment,
      })
      .returning();
  }

  let result: SyncResult;

  try {
    if (direction === 'push') {
      result = await executePush(
        vaultId,
        keywayEnvironment,
        provider,
        accessToken,
        projectId,
        providerEnvironment,
        connection.providerTeamId || undefined,
        allowDelete
      );
    } else {
      result = await executePull(
        vaultId,
        keywayEnvironment,
        provider,
        accessToken,
        projectId,
        providerEnvironment,
        connection.providerTeamId || undefined
      );
    }

    // Update last synced and log atomically
    await db.transaction(async (tx) => {
      await tx
        .update(vaultSyncs)
        .set({ lastSyncedAt: new Date() })
        .where(eq(vaultSyncs.id, syncConfig.id));

      await tx.insert(syncLogs).values({
        syncId: syncConfig.id,
        vaultId,
        provider: connection.provider,
        direction,
        status: result.status,
        secretsCreated: result.created,
        secretsUpdated: result.updated,
        secretsDeleted: result.deleted,
        secretsSkipped: result.skipped,
        error: result.error,
        triggeredBy,
      });
    });

  } catch (error) {
    result = {
      status: 'failed',
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    // Log the failed sync (outside transaction since sync failed)
    await db.insert(syncLogs).values({
      syncId: syncConfig.id,
      vaultId,
      provider: connection.provider,
      direction,
      status: result.status,
      secretsCreated: result.created,
      secretsUpdated: result.updated,
      secretsDeleted: result.deleted,
      secretsSkipped: result.skipped,
      error: result.error,
      triggeredBy,
    });
  }

  return result;
}

/**
 * Execute push: Keyway → Provider
 */
async function executePush(
  vaultId: string,
  keywayEnvironment: string,
  provider: ReturnType<typeof getProvider>,
  accessToken: string,
  projectId: string,
  providerEnvironment: string,
  teamId: string | undefined,
  allowDelete: boolean
): Promise<SyncResult> {
  if (!provider) throw new Error('Provider not found');

  // Get Keyway secrets
  const keywaySecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment)
    ),
  });

  const varsToSet: Record<string, string> = {};
  const decryptionErrors: string[] = [];
  for (const secret of keywaySecrets) {
    const decrypted = await safeDecryptSecret(secret);
    if (decrypted) {
      varsToSet[decrypted.key] = decrypted.value;
    } else {
      decryptionErrors.push(secret.key);
    }
  }

  // Log if there were decryption errors but continue with available secrets
  if (decryptionErrors.length > 0) {
    console.warn(`[IntegrationService] Skipped ${decryptionErrors.length} secrets in push due to decryption errors: ${decryptionErrors.join(', ')}`);
  }

  // Set env vars
  const { created, updated } = await provider.setEnvVars(
    accessToken,
    projectId,
    providerEnvironment,
    varsToSet,
    teamId
  );

  let deleted = 0;
  if (allowDelete) {
    // Get provider env vars
    const providerEnvVars = await provider.listEnvVars(
      accessToken,
      projectId,
      providerEnvironment,
      teamId
    );

    const keysToDelete = providerEnvVars
      .filter(env => !varsToSet[env.key])
      .map(env => env.key);

    if (keysToDelete.length > 0) {
      if (provider.deleteEnvVars) {
        const result = await provider.deleteEnvVars(accessToken, projectId, providerEnvironment, keysToDelete, teamId);
        deleted = result.deleted;
      } else {
        for (const key of keysToDelete) {
          await provider.deleteEnvVar(accessToken, projectId, providerEnvironment, key, teamId);
          deleted++;
        }
      }
    }
  }

  return {
    status: 'success',
    created,
    updated,
    deleted,
    skipped: 0,
  };
}

/**
 * Execute pull: Provider → Keyway
 */
async function executePull(
  vaultId: string,
  keywayEnvironment: string,
  provider: ReturnType<typeof getProvider>,
  accessToken: string,
  projectId: string,
  providerEnvironment: string,
  teamId: string | undefined
): Promise<SyncResult> {
  if (!provider) throw new Error('Provider not found');

  // Get provider env vars
  const providerEnvVars = await provider.listEnvVars(
    accessToken,
    projectId,
    providerEnvironment,
    teamId
  );

  // Get existing Keyway secrets
  const existingSecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment)
    ),
  });

  const existingKeys = new Set(existingSecrets.map(s => s.key));

  let created = 0;
  let skipped = 0;

  for (const envVar of providerEnvVars) {
    if (!envVar.value) {
      skipped++;
      continue;
    }

    if (existingKeys.has(envVar.key)) {
      skipped++;
      continue;
    }

    // Create new secret
    const encryptionService = await getEncryptionService();
    const encrypted = await encryptionService.encrypt(envVar.value);
    await db.insert(secrets).values({
      vaultId,
      environment: keywayEnvironment,
      key: envVar.key,
      encryptedValue: encrypted.encryptedContent,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
    created++;
  }

  return {
    status: 'success',
    created,
    updated: 0,
    deleted: 0,
    skipped,
  };
}
