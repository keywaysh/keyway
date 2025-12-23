/**
 * Exposure Service - Tracks which secrets each user has accessed
 * Enables offboarding: "Dev leaves? You know exactly what to rotate."
 */
import { db, secretAccesses, users, vaults, secrets } from '../db';
import { eq, and, desc, sql, count, gte, lte, inArray } from 'drizzle-orm';
import type { ActivityPlatform, CollaboratorRole, Secret } from '../db/schema';

// ============ TYPES ============

export interface RecordAccessContext {
  userId: string;
  username: string;
  userAvatarUrl: string | null;
  vaultId: string;
  repoFullName: string;
  environment: string;
  githubRole: CollaboratorRole;
  platform: ActivityPlatform;
  ipAddress?: string | null;
  deviceId?: string | null;
  pullEventId?: string | null;
}

export interface SecretAccessRecord {
  secretId: string;
  secretKey: string;
}

export interface ExposureUserSummary {
  user: {
    id: string | null;
    username: string;
    avatarUrl: string | null;
  };
  secretsAccessed: number;
  vaultsAccessed: number;
  lastAccess: string;
}

export interface ExposureSecretDetail {
  secretId: string | null;
  key: string;
  environment: string;
  roleAtAccess: CollaboratorRole;
  firstAccess: string;
  lastAccess: string;
  accessCount: number;
}

export interface ExposureVaultGroup {
  vaultId: string | null;
  repoFullName: string;
  secrets: ExposureSecretDetail[];
}

export interface ExposureUserReport {
  user: {
    id: string | null;
    username: string;
    avatarUrl: string | null;
  };
  summary: {
    totalSecretsAccessed: number;
    totalVaultsAccessed: number;
    firstAccess: string | null;
    lastAccess: string | null;
  };
  vaults: ExposureVaultGroup[];
}

export interface ExposureOrgSummary {
  summary: {
    users: number;
    secrets: number;
    accesses: number;
  };
  users: ExposureUserSummary[];
}

// ============ RECORDING FUNCTIONS ============

/**
 * Record access to multiple secrets (batch UPSERT for pull operations)
 * Fire-and-forget: errors are logged but don't block the caller
 */
export async function recordSecretAccesses(
  ctx: RecordAccessContext,
  secretRecords: SecretAccessRecord[]
): Promise<void> {

  if (secretRecords.length === 0) return;

  // Use raw SQL for efficient batch UPSERT with ON CONFLICT
  const values = secretRecords.map(s => ({
    userId: ctx.userId,
    username: ctx.username,
    userAvatarUrl: ctx.userAvatarUrl,
    secretId: s.secretId,
    secretKey: s.secretKey,
    vaultId: ctx.vaultId,
    repoFullName: ctx.repoFullName,
    environment: ctx.environment,
    githubRole: ctx.githubRole,
    platform: ctx.platform,
    ipAddress: ctx.ipAddress || null,
    deviceId: ctx.deviceId || null,
    pullEventId: ctx.pullEventId || null,
  }));

  // Batch insert with ON CONFLICT - update last_accessed_at and increment count
  // Errors propagate to the call site's .catch() for logging (fire-and-forget pattern)
  for (const value of values) {
    await db
      .insert(secretAccesses)
      .values(value)
      .onConflictDoUpdate({
        target: [secretAccesses.userId, secretAccesses.secretId],
        set: {
          lastAccessedAt: new Date(),
          accessCount: sql`${secretAccesses.accessCount} + 1`,
          // Update context fields to latest values
          githubRole: value.githubRole,
          platform: value.platform,
          ipAddress: value.ipAddress,
          deviceId: value.deviceId,
          pullEventId: value.pullEventId,
        },
      });
  }
}

/**
 * Record access to a single secret (for view operations)
 * Fire-and-forget: errors are logged but don't block the caller
 */
export async function recordSecretAccess(
  ctx: RecordAccessContext,
  secretRecord: SecretAccessRecord
): Promise<void> {
  await recordSecretAccesses(ctx, [secretRecord]);
}

// ============ QUERY FUNCTIONS ============

/**
 * Get exposure report for a specific user in an organization
 */
export async function getExposureForUser(
  username: string,
  orgRepoPrefix: string
): Promise<ExposureUserReport | null> {
  // Get all accesses for this username in org repos
  const accesses = await db.query.secretAccesses.findMany({
    where: and(
      eq(secretAccesses.username, username),
      sql`${secretAccesses.repoFullName} LIKE ${orgRepoPrefix + '%'}`
    ),
    orderBy: [desc(secretAccesses.lastAccessedAt)],
  });

  if (accesses.length === 0) {
    return null;
  }

  // Get user info from first access (or from the user if they still exist)
  const firstAccess = accesses[0];

  // Group by vault
  const vaultMap = new Map<string, ExposureSecretDetail[]>();
  let firstAccessDate: Date | null = null;
  let lastAccessDate: Date | null = null;

  for (const access of accesses) {
    const vaultKey = access.repoFullName;
    if (!vaultMap.has(vaultKey)) {
      vaultMap.set(vaultKey, []);
    }

    vaultMap.get(vaultKey)!.push({
      secretId: access.secretId,
      key: access.secretKey,
      environment: access.environment,
      roleAtAccess: access.githubRole,
      firstAccess: access.firstAccessedAt.toISOString(),
      lastAccess: access.lastAccessedAt.toISOString(),
      accessCount: access.accessCount,
    });

    // Track date range
    if (!firstAccessDate || access.firstAccessedAt < firstAccessDate) {
      firstAccessDate = access.firstAccessedAt;
    }
    if (!lastAccessDate || access.lastAccessedAt > lastAccessDate) {
      lastAccessDate = access.lastAccessedAt;
    }
  }

  const vaultGroups: ExposureVaultGroup[] = Array.from(vaultMap.entries()).map(
    ([repoFullName, secrets]) => {
      // Get vaultId from any access in this group
      const vaultAccess = accesses.find(a => a.repoFullName === repoFullName);
      return {
        vaultId: vaultAccess?.vaultId || null,
        repoFullName,
        secrets,
      };
    }
  );

  return {
    user: {
      id: firstAccess.userId,
      username: firstAccess.username,
      avatarUrl: firstAccess.userAvatarUrl,
    },
    summary: {
      totalSecretsAccessed: accesses.length,
      totalVaultsAccessed: vaultMap.size,
      firstAccess: firstAccessDate?.toISOString() || null,
      lastAccess: lastAccessDate?.toISOString() || null,
    },
    vaults: vaultGroups,
  };
}

/**
 * Get org-level exposure summary
 */
export async function getExposureForOrg(
  orgRepoPrefix: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    vaultId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<ExposureOrgSummary> {
  // Build where conditions
  const conditions = [
    sql`${secretAccesses.repoFullName} LIKE ${orgRepoPrefix + '%'}`,
  ];

  if (options?.startDate) {
    conditions.push(gte(secretAccesses.lastAccessedAt, options.startDate));
  }
  if (options?.endDate) {
    conditions.push(lte(secretAccesses.lastAccessedAt, options.endDate));
  }
  if (options?.vaultId) {
    conditions.push(eq(secretAccesses.vaultId, options.vaultId));
  }

  const whereClause = and(...conditions);

  // Get unique users with their access stats
  const userStats = await db
    .select({
      username: secretAccesses.username,
      userId: secretAccesses.userId,
      userAvatarUrl: secretAccesses.userAvatarUrl,
      secretCount: count(secretAccesses.id),
      lastAccess: sql<Date>`MAX(${secretAccesses.lastAccessedAt})`.as('last_access'),
    })
    .from(secretAccesses)
    .where(whereClause)
    .groupBy(
      secretAccesses.username,
      secretAccesses.userId,
      secretAccesses.userAvatarUrl
    )
    .orderBy(desc(sql`MAX(${secretAccesses.lastAccessedAt})`))
    .limit(options?.limit ?? 100)
    .offset(options?.offset ?? 0);

  // Get vault counts per user (separate query for efficiency)
  const userVaultCounts = await db
    .select({
      username: secretAccesses.username,
      vaultCount: sql<number>`COUNT(DISTINCT ${secretAccesses.vaultId})`.as('vault_count'),
    })
    .from(secretAccesses)
    .where(whereClause)
    .groupBy(secretAccesses.username);

  const vaultCountMap = new Map(
    userVaultCounts.map(u => [u.username, Number(u.vaultCount)])
  );

  // Get total counts
  const [totals] = await db
    .select({
      users: sql<number>`COUNT(DISTINCT ${secretAccesses.username})`.as('users'),
      secrets: sql<number>`COUNT(DISTINCT ${secretAccesses.secretId})`.as('secrets'),
      accesses: sql<number>`SUM(${secretAccesses.accessCount})`.as('accesses'),
    })
    .from(secretAccesses)
    .where(whereClause);

  const users: ExposureUserSummary[] = userStats.map(stat => ({
    user: {
      id: stat.userId,
      username: stat.username,
      avatarUrl: stat.userAvatarUrl,
    },
    secretsAccessed: Number(stat.secretCount),
    vaultsAccessed: vaultCountMap.get(stat.username) ?? 0,
    // lastAccess comes as string from raw SQL, convert to ISO string
    lastAccess: stat.lastAccess instanceof Date
      ? stat.lastAccess.toISOString()
      : new Date(stat.lastAccess).toISOString(),
  }));

  return {
    summary: {
      users: Number(totals?.users ?? 0),
      secrets: Number(totals?.secrets ?? 0),
      accesses: Number(totals?.accesses ?? 0),
    },
    users,
  };
}

/**
 * Get access history for a specific secret
 */
export async function getSecretAccessHistory(
  secretId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{
  accesses: Array<{
    user: { id: string | null; username: string; avatarUrl: string | null };
    roleAtAccess: CollaboratorRole;
    platform: ActivityPlatform;
    firstAccess: string;
    lastAccess: string;
    accessCount: number;
  }>;
  total: number;
}> {
  const [countResult] = await db
    .select({ count: count() })
    .from(secretAccesses)
    .where(eq(secretAccesses.secretId, secretId));

  const accesses = await db.query.secretAccesses.findMany({
    where: eq(secretAccesses.secretId, secretId),
    orderBy: [desc(secretAccesses.lastAccessedAt)],
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
  });

  return {
    accesses: accesses.map(a => ({
      user: {
        id: a.userId,
        username: a.username,
        avatarUrl: a.userAvatarUrl,
      },
      roleAtAccess: a.githubRole,
      platform: a.platform,
      firstAccess: a.firstAccessedAt.toISOString(),
      lastAccess: a.lastAccessedAt.toISOString(),
      accessCount: a.accessCount,
    })),
    total: countResult?.count ?? 0,
  };
}
