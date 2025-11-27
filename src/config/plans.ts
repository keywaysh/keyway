import type { UserPlan } from '../db/schema';

/**
 * Plan configuration
 * Defines limits for each pricing tier
 */
export interface PlanLimits {
  /** Maximum number of public repositories allowed */
  maxPublicRepos: number;
  /** Maximum number of private repositories allowed */
  maxPrivateRepos: number;
}

/**
 * Plan definitions
 * - free: Unlimited public repos, 1 private repo
 * - pro: Unlimited everything
 * - team: Unlimited everything (for organizations)
 */
export const PLANS: Record<UserPlan, PlanLimits> = {
  free: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: 1,
  },
  pro: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: Infinity,
  },
  team: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: Infinity,
  },
} as const;

/**
 * Get limits for a specific plan
 */
export function getPlanLimits(plan: UserPlan): PlanLimits {
  return PLANS[plan];
}

/**
 * Check if a plan allows creating a new repo of the given visibility
 */
export function canCreateRepo(
  plan: UserPlan,
  currentPublicCount: number,
  currentPrivateCount: number,
  isPrivate: boolean
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  if (isPrivate) {
    if (currentPrivateCount >= limits.maxPrivateRepos) {
      return {
        allowed: false,
        reason: `Your ${plan} plan allows ${limits.maxPrivateRepos} private repo${limits.maxPrivateRepos === 1 ? '' : 's'}. Upgrade to create more.`,
      };
    }
  } else {
    if (currentPublicCount >= limits.maxPublicRepos) {
      return {
        allowed: false,
        reason: `Your ${plan} plan allows ${limits.maxPublicRepos} public repos. Upgrade to create more.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Format limit for API response
 * Returns "unlimited" string for Infinity, or the number
 */
export function formatLimit(limit: number): string | number {
  return limit === Infinity ? 'unlimited' : limit;
}
