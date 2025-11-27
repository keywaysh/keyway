import { db, users, vaults, usageMetrics } from '../db';
import { eq, and, sql } from 'drizzle-orm';
import type { UserPlan } from '../db/schema';
import { getPlanLimits, formatLimit, canCreateRepo } from '../config/plans';

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
  isPrivate: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getUserUsage(userId);
  return canCreateRepo(plan, usage.public, usage.private, isPrivate);
}
