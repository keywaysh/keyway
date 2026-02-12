/**
 * Integration Service
 * Handles provider connections and sync operations
 */

import { eq, and, isNull } from "drizzle-orm";
import { db, providerConnections, vaultSyncs, syncLogs, secrets } from "../db";
import { getProvider } from "./providers";
import { getEncryptionService } from "../utils/encryption";
import type { SyncDirection, SyncStatus } from "../db/schema";
import { logger } from "../utils/sharedLogger";

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
    accessTokenVersion: encrypted.version ?? 1,
  };
}

// Helper to decrypt provider token
async function decryptProviderToken(connection: {
  encryptedAccessToken: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
  accessTokenVersion?: number | null;
}): Promise<string> {
  const encryptionService = await getEncryptionService();
  return encryptionService.decrypt({
    encryptedContent: connection.encryptedAccessToken,
    iv: connection.accessTokenIv,
    authTag: connection.accessTokenAuthTag,
    version: connection.accessTokenVersion ?? 1,
  });
}

// Helper to decrypt provider refresh token
async function decryptProviderRefreshToken(connection: {
  encryptedRefreshToken: string | null;
  refreshTokenIv: string | null;
  refreshTokenAuthTag: string | null;
  refreshTokenVersion?: number | null;
}): Promise<string | null> {
  if (
    !connection.encryptedRefreshToken ||
    !connection.refreshTokenIv ||
    !connection.refreshTokenAuthTag
  ) {
    return null;
  }
  const encryptionService = await getEncryptionService();
  return encryptionService.decrypt({
    encryptedContent: connection.encryptedRefreshToken,
    iv: connection.refreshTokenIv,
    authTag: connection.refreshTokenAuthTag,
    version: connection.refreshTokenVersion ?? 1,
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
  encryptionVersion?: number | null;
  key: string;
}): Promise<{ key: string; value: string } | null> {
  try {
    const encryptionService = await getEncryptionService();
    const value = await encryptionService.decrypt({
      encryptedContent: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
      version: secret.encryptionVersion ?? 1,
    });
    return { key: secret.key, value };
  } catch (error) {
    logger.error(
      { secretKey: secret.key, error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to decrypt secret"
    );
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
  accessTokenVersion?: number | null;
  encryptedRefreshToken: string | null;
  refreshTokenIv: string | null;
  refreshTokenAuthTag: string | null;
  refreshTokenVersion?: number | null;
  tokenExpiresAt: Date | null;
};

/**
 * Get valid access token, refreshing if expired
 */
async function getValidAccessToken(connection: ConnectionWithTokens): Promise<string> {
  // Check if token is expired
  if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
    logger.info(
      { connectionId: connection.id, provider: connection.provider },
      "Token expired, attempting refresh"
    );
    const provider = getProvider(connection.provider);
    const refreshToken = await decryptProviderRefreshToken(connection);

    if (provider?.refreshToken && refreshToken) {
      try {
        const newTokens = await provider.refreshToken(refreshToken);
        logger.info({ connectionId: connection.id }, "Token refreshed successfully");

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
      } catch (error) {
        logger.error(
          {
            connectionId: connection.id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Token refresh failed"
        );
        throw new Error("Token expired and refresh failed. Please reconnect to provider.");
      }
    }

    logger.error({ connectionId: connection.id }, "Token expired and no refresh token available");
    throw new Error("Token expired. Please reconnect to provider.");
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

  if (!connection) {
    return null;
  }

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

  return connections.map((c) => ({
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
      refreshTokenVersion: encryptedRefresh.version ?? 1,
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
      target: [
        providerConnections.userId,
        providerConnections.provider,
        providerConnections.providerTeamId,
      ],
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
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)))
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

  if (!connection) {
    return null;
  }

  return decryptProviderToken(connection);
}

/**
 * List provider projects for a connection
 * Requires userId for ownership validation
 */
export async function listProviderProjects(connectionId: string, userId: string) {
  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)),
  });

  if (!connection) {
    throw new Error("Connection not found");
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  const accessToken = await getValidAccessToken(connection);
  return provider.listProjects(accessToken, connection.providerTeamId || undefined);
}

/**
 * Project with connection info for multi-account support
 */
export interface ProjectWithConnection {
  id: string;
  name: string;
  linkedRepo?: string;
  framework?: string;
  createdAt?: Date;
  connectionId: string;
  teamId: string | null;
  teamName?: string;
}

/**
 * List projects from ALL connections for a provider
 * Used for auto-detection when user has multiple accounts/teams
 */
export async function listAllProviderProjects(
  userId: string,
  providerName: string
): Promise<{ projects: ProjectWithConnection[]; connections: ConnectionInfo[] }> {
  // Get all connections for this provider
  const connections = await db.query.providerConnections.findMany({
    where: and(
      eq(providerConnections.userId, userId),
      eq(providerConnections.provider, providerName)
    ),
  });

  if (connections.length === 0) {
    return { projects: [], connections: [] };
  }

  const provider = getProvider(providerName);
  if (!provider) {
    throw new Error(`Provider ${providerName} not found`);
  }

  // Fetch projects from all connections in parallel
  const projectResults = await Promise.allSettled(
    connections.map(async (connection) => {
      try {
        const accessToken = await getValidAccessToken(connection);
        const projects = await provider.listProjects(
          accessToken,
          connection.providerTeamId || undefined
        );
        return {
          connectionId: connection.id,
          teamId: connection.providerTeamId,
          projects,
        };
      } catch (error) {
        // Log but don't fail - one expired token shouldn't block all connections
        logger.warn(
          {
            connectionId: connection.id,
            teamId: connection.providerTeamId,
            error: error instanceof Error ? error.message : "Unknown",
          },
          "Failed to fetch projects for connection, skipping"
        );
        return null;
      }
    })
  );

  // Aggregate projects with connection info
  const allProjects: ProjectWithConnection[] = [];
  const teamIdsToFetch = new Set<string>();

  for (const result of projectResults) {
    if (result.status === "fulfilled" && result.value) {
      const { connectionId, teamId, projects } = result.value;
      if (teamId) {
        teamIdsToFetch.add(teamId);
      }
      for (const project of projects) {
        allProjects.push({
          ...project,
          connectionId,
          teamId,
        });
      }
    }
  }

  // Fetch team names if provider supports it
  const teamNames = new Map<string, string>();
  if (teamIdsToFetch.size > 0 && provider.getTeam) {
    // Try to get a valid access token from any connection
    let accessToken: string | null = null;
    for (const connection of connections) {
      try {
        accessToken = await getValidAccessToken(connection);
        break;
      } catch {
        // Try next connection
      }
    }

    if (accessToken) {
      try {
        // Fetch team names in parallel
        const teamResults = await Promise.allSettled(
          Array.from(teamIdsToFetch).map(async (teamId) => {
            const team = await provider.getTeam!(accessToken!, teamId);
            return { teamId, teamName: team?.name };
          })
        );

        for (const result of teamResults) {
          if (result.status === "fulfilled" && result.value.teamName) {
            teamNames.set(result.value.teamId, result.value.teamName);
          }
        }
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : "Unknown" },
          "Failed to fetch team names"
        );
      }
    }
  }

  // Add team names to projects
  for (const project of allProjects) {
    if (project.teamId && teamNames.has(project.teamId)) {
      project.teamName = teamNames.get(project.teamId);
    }
  }

  // Return connection info for UI (picker)
  const connectionInfos: ConnectionInfo[] = connections.map((c) => ({
    id: c.id,
    provider: c.provider,
    providerUserId: c.providerUserId,
    providerTeamId: c.providerTeamId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return { projects: allProjects, connections: connectionInfos };
}

/**
 * Link info returned when linking a vault to a provider project
 */
export interface VaultSyncLink {
  id: string;
  vaultId: string;
  connectionId: string;
  provider: string;
  projectId: string;
  projectName: string | null;
  keywayEnvironment: string;
  providerEnvironment: string;
  lastSyncedAt: Date | null;
  isNew: boolean;
}

/**
 * Link a vault to a provider project (without syncing)
 * Creates the vault_sync record if it doesn't exist
 * This allows users to "save" their project selection before actually syncing
 */
export async function linkVaultToProject(
  vaultId: string,
  connectionId: string,
  projectId: string,
  keywayEnvironment: string,
  providerEnvironment: string,
  userId: string
): Promise<VaultSyncLink> {
  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)),
  });

  if (!connection) {
    throw new Error("Connection not found");
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  // Check if link already exists
  let syncConfig = await db.query.vaultSyncs.findFirst({
    where: and(
      eq(vaultSyncs.vaultId, vaultId),
      eq(vaultSyncs.connectionId, connectionId),
      eq(vaultSyncs.providerProjectId, projectId),
      eq(vaultSyncs.providerEnvironment, providerEnvironment)
    ),
  });

  let isNew = false;

  if (!syncConfig) {
    // Get project name from provider
    let projectName: string | undefined;
    if (provider.getProject) {
      try {
        const accessToken = await getValidAccessToken(connection);
        const project = await provider.getProject(
          accessToken,
          projectId,
          connection.providerTeamId || undefined
        );
        projectName = project?.name;
      } catch (error) {
        logger.warn(
          { projectId, error: error instanceof Error ? error.message : "Unknown" },
          "Failed to fetch project name"
        );
      }
    }

    // Create the link
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

    isNew = true;
    logger.info(
      { vaultId, projectId, provider: connection.provider },
      "Created vault-project link"
    );
  }

  return {
    id: syncConfig.id,
    vaultId: syncConfig.vaultId,
    connectionId: syncConfig.connectionId,
    provider: syncConfig.provider,
    projectId: syncConfig.providerProjectId,
    projectName: syncConfig.providerProjectName,
    keywayEnvironment: syncConfig.keywayEnvironment,
    providerEnvironment: syncConfig.providerEnvironment,
    lastSyncedAt: syncConfig.lastSyncedAt,
    isNew,
  };
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
    // Check if vault has secrets (active only, excludes trash)
    db.query.secrets.findMany({
      where: and(
        eq(secrets.vaultId, vaultId),
        eq(secrets.environment, environment),
        isNull(secrets.deletedAt)
      ),
    }),
    // Get connection for provider access (with ownership validation)
    db.query.providerConnections.findFirst({
      where: and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)),
    }),
  ]);

  if (!connection) {
    throw new Error("Connection not found");
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
 * Bi-directional diff result
 */
export interface SyncDiff {
  keywayCount: number;
  providerCount: number;
  onlyInKeyway: string[];
  onlyInProvider: string[];
  different: string[];
  same: string[];
}

/**
 * Get bi-directional sync diff (compare Keyway vs Provider)
 * Returns what's different on each side, without specifying a direction
 */
export async function getSyncDiff(
  vaultId: string,
  connectionId: string,
  projectId: string,
  keywayEnvironment: string,
  providerEnvironment: string,
  userId: string
): Promise<SyncDiff> {
  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)),
  });

  if (!connection) {
    throw new Error("Connection not found");
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  const accessToken = await getValidAccessToken(connection);

  // Get Keyway secrets (active only, excludes trash)
  const keywaySecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment),
      isNull(secrets.deletedAt)
    ),
  });

  const keywaySecretsMap = new Map<string, string>();
  for (const secret of keywaySecrets) {
    const decrypted = await safeDecryptSecret(secret);
    if (decrypted) {
      keywaySecretsMap.set(decrypted.key, decrypted.value);
    }
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

  const onlyInKeyway: string[] = [];
  const onlyInProvider: string[] = [];
  const different: string[] = [];
  const same: string[] = [];

  // Check Keyway secrets
  for (const [key, value] of keywaySecretsMap) {
    const providerValue = providerSecretsMap.get(key);
    if (providerValue === undefined) {
      onlyInKeyway.push(key);
    } else if (providerValue !== value) {
      different.push(key);
    } else {
      same.push(key);
    }
  }

  // Check provider secrets not in Keyway
  for (const key of providerSecretsMap.keys()) {
    if (!keywaySecretsMap.has(key)) {
      onlyInProvider.push(key);
    }
  }

  return {
    keywayCount: keywaySecretsMap.size,
    providerCount: providerSecretsMap.size,
    onlyInKeyway,
    onlyInProvider,
    different,
    same,
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
    where: and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)),
  });

  if (!connection) {
    throw new Error("Connection not found");
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`Provider ${connection.provider} not found`);
  }

  const accessToken = await getValidAccessToken(connection);

  // Get Keyway secrets (active only, excludes trash)
  const keywaySecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment),
      isNull(secrets.deletedAt)
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
    logger.warn(
      { count: decryptionErrors.length, keys: decryptionErrors },
      "Skipped secrets due to decryption errors"
    );
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

  if (direction === "push") {
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
  logger.info(
    { vaultId, direction, keywayEnvironment, providerEnvironment },
    "executeSync started"
  );

  // Validate connection belongs to the user (IDOR protection)
  const connection = await db.query.providerConnections.findFirst({
    where: and(
      eq(providerConnections.id, connectionId),
      eq(providerConnections.userId, triggeredBy)
    ),
  });

  if (!connection) {
    logger.error({ connectionId, userId: triggeredBy }, "Connection not found");
    throw new Error("Connection not found");
  }

  logger.debug(
    { provider: connection.provider, teamId: connection.providerTeamId },
    "Connection found"
  );

  const provider = getProvider(connection.provider);
  if (!provider) {
    logger.error({ provider: connection.provider }, "Provider not found");
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
      const project = await provider.getProject(
        accessToken,
        projectId,
        connection.providerTeamId || undefined
      );
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
    if (direction === "push") {
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error: errorMessage, vaultId, direction }, "Sync failed");

    result = {
      status: "failed",
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      error: errorMessage,
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

  logger.info(
    {
      status: result.status,
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
      skipped: result.skipped,
    },
    "Sync completed"
  );
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
  if (!provider) {
    throw new Error("Provider not found");
  }

  // Get Keyway secrets (active only, excludes trash)
  const keywaySecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment),
      isNull(secrets.deletedAt)
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
    logger.warn(
      { count: decryptionErrors.length, keys: decryptionErrors },
      "Skipped secrets in push due to decryption errors"
    );
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

    const keysToDelete = providerEnvVars.filter((env) => !varsToSet[env.key]).map((env) => env.key);

    if (keysToDelete.length > 0) {
      if (provider.deleteEnvVars) {
        const result = await provider.deleteEnvVars(
          accessToken,
          projectId,
          providerEnvironment,
          keysToDelete,
          teamId
        );
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
    status: "success",
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
  if (!provider) {
    throw new Error("Provider not found");
  }

  // Get provider env vars
  const providerEnvVars = await provider.listEnvVars(
    accessToken,
    projectId,
    providerEnvironment,
    teamId
  );

  // Get existing Keyway secrets (active only, excludes trash)
  const existingSecrets = await db.query.secrets.findMany({
    where: and(
      eq(secrets.vaultId, vaultId),
      eq(secrets.environment, keywayEnvironment),
      isNull(secrets.deletedAt)
    ),
  });

  const existingKeys = new Set(existingSecrets.map((s) => s.key));

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
      encryptionVersion: encrypted.version ?? 1,
    });
    created++;
  }

  return {
    status: "success",
    created,
    updated: 0,
    deleted: 0,
    skipped,
  };
}
