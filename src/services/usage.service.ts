import { db, users, vaults, usageMetrics } from '../db';
import { eq, and, sql, asc } from 'drizzle-orm';
import type { UserPlan } from '../db/schema';
import { getPlanLimits, formatLimit, canCreateRepo, PLANS } from '../config/plans';

/**
 * Usage data for a user
 */
export interface UserUsage {
  public: number;
  private: number;
}

/**
 * Full usage response including plan info
 */
export interface UserUsageResponse {
  plan: UserPlan;
  limits: {
    maxPublicRepos: string | number;
    maxPrivateRepos: string | number;
  };
  usage: UserUsage;
}

/**
 * Compute and cache usage metrics for a user
 * Counts vaults owned by the user, split by visibility
 */
export async function computeUserUsage(userId: string): Promise<UserUsage> {
  // Count public and private vaults owned by the user
  const counts = await db
    .select({
      isPrivate: vaults.isPrivate,
      count: sql<number>`count(*)::int`,
    })
    .from(vaults)
    .where(eq(vaults.ownerId, userId))
    .groupBy(vaults.isPrivate);

  let publicCount = 0;
  let privateCount = 0;

  for (const row of counts) {
    if (row.isPrivate) {
      privateCount = row.count;
    } else {
      publicCount = row.count;
    }
  }

  // Update the cached metrics (upsert)
  await db
    .insert(usageMetrics)
    .values({
      userId,
      totalPublicRepos: publicCount,
      totalPrivateRepos: privateCount,
      lastComputed: new Date(),
    })
    .onConflictDoUpdate({
      target: usageMetrics.userId,
      set: {
        totalPublicRepos: publicCount,
        totalPrivateRepos: privateCount,
        lastComputed: new Date(),
      },
    });

  return {
    public: publicCount,
    private: privateCount,
  };
}

/**
 * Get cached usage metrics for a user
 * Falls back to computing if not cached
 */
export async function getUserUsage(userId: string): Promise<UserUsage> {
  const cached = await db.query.usageMetrics.findFirst({
    where: eq(usageMetrics.userId, userId),
  });

  if (cached) {
    return {
      public: cached.totalPublicRepos,
      private: cached.totalPrivateRepos,
    };
  }

  // Compute if not cached
  return computeUserUsage(userId);
}

/**
 * Get full usage response for the /users/me/usage endpoint
 */
export async function getUserUsageResponse(userId: string, plan: UserPlan): Promise<UserUsageResponse> {
  const usage = await getUserUsage(userId);
  const limits = getPlanLimits(plan);

  return {
    plan,
    limits: {
      maxPublicRepos: formatLimit(limits.maxPublicRepos),
      maxPrivateRepos: formatLimit(limits.maxPrivateRepos),
    },
    usage,
  };
}

/**
 * Check if user can create a new vault
 * Returns allowed status and optional error reason
 */
export async function checkVaultCreationAllowed(
  userId: string,
  plan: UserPlan,
  isPrivate: boolean,
  isOrganization: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getUserUsage(userId);
  return canCreateRepo(plan, usage.public, usage.private, isPrivate, isOrganization);
}

/**
 * Private vault access result
 */
export interface PrivateVaultAccess {
  /** Vault IDs within plan limit (write allowed) */
  allowedVaultIds: Set<string>;
  /** Vault IDs exceeding plan limit (read-only) */
  excessVaultIds: Set<string>;
}

/**
 * Get user's private vaults ordered by creation date (oldest first).
 * The first N vaults (within plan limit) are "allowed", rest are "excess".
 *
 * For Pro/Team plans (unlimited), returns empty sets (all vaults are allowed).
 */
export async function getPrivateVaultAccess(userId: string, plan: UserPlan): Promise<PrivateVaultAccess> {
  const limit = PLANS[plan].maxPrivateRepos;

  // If unlimited, all vaults are allowed - return empty sets as special case
  if (limit === Infinity) {
    return { allowedVaultIds: new Set(), excessVaultIds: new Set() };
  }

  // Get private vaults ordered by creation date (FIFO - oldest first)
  const privateVaults = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(and(eq(vaults.ownerId, userId), eq(vaults.isPrivate, true)))
    .orderBy(asc(vaults.createdAt));

  const allowedVaultIds = new Set(privateVaults.slice(0, limit).map(v => v.id));
  const excessVaultIds = new Set(privateVaults.slice(limit).map(v => v.id));

  return { allowedVaultIds, excessVaultIds };
}

/**
 * Check if a specific vault allows write operations for this user's plan.
 *
 * - Public vaults: always writable
 * - Pro/Team plans: always writable
 * - Free plan + private vault: only if within the 1-vault limit (oldest vault)
 */
export async function canWriteToVault(
  userId: string,
  plan: UserPlan,
  vaultId: string,
  isPrivate: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  // Public vaults: always allowed
  if (!isPrivate) {
    return { allowed: true };
  }

  // Pro/Team plans: always allowed (unlimited private repos)
  if (PLANS[plan].maxPrivateRepos === Infinity) {
    return { allowed: true };
  }

  // Free plan with private vault: check if it's within limit
  const { excessVaultIds } = await getPrivateVaultAccess(userId, plan);

  if (excessVaultIds.has(vaultId)) {
    return {
      allowed: false,
      reason: 'This private vault is read-only on the Free plan. Upgrade to Pro to unlock editing.',
    };
  }

  return { allowed: true };
}
