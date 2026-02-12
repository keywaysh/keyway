import type { UserPlan } from "../db/schema";

/**
 * Plan configuration
 * Defines limits for each pricing tier
 */
export interface PlanLimits {
  /** Maximum number of public repositories allowed */
  maxPublicRepos: number;
  /** Maximum number of private repositories allowed */
  maxPrivateRepos: number;
  /** Maximum number of provider connections (Vercel, etc.) */
  maxProviders: number;
  /** Maximum number of environments per vault */
  maxEnvironmentsPerVault: number;
  /** Maximum number of secrets per private vault (public vaults are unlimited) */
  maxSecretsPerPrivateVault: number;
  /** Maximum number of collaborators per vault */
  maxCollaboratorsPerVault: number;
}

/**
 * Plan definitions
 * - free: 1 private repo, 2 providers, 3 envs, 15 collaborators
 * - pro: 5 private repos, unlimited providers/envs, 15 collaborators ($4/month)
 * - team: 10 private repos, unlimited providers/envs, 15 collaborators ($15/month)
 * - startup: 40 private repos, unlimited providers/envs, 30 collaborators ($39/month)
 */
export const PLANS: Record<UserPlan, PlanLimits> = {
  free: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: 1,
    maxProviders: 2,
    maxEnvironmentsPerVault: 3,
    maxSecretsPerPrivateVault: Infinity,
    maxCollaboratorsPerVault: 15,
  },
  pro: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: 5,
    maxProviders: Infinity,
    maxEnvironmentsPerVault: Infinity,
    maxSecretsPerPrivateVault: Infinity,
    maxCollaboratorsPerVault: 15,
  },
  team: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: 10,
    maxProviders: Infinity,
    maxEnvironmentsPerVault: Infinity,
    maxSecretsPerPrivateVault: Infinity,
    maxCollaboratorsPerVault: 15,
  },
  startup: {
    maxPublicRepos: Infinity,
    maxPrivateRepos: 40,
    maxProviders: Infinity,
    maxEnvironmentsPerVault: Infinity,
    maxSecretsPerPrivateVault: Infinity,
    maxCollaboratorsPerVault: 30,
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
  isPrivate: boolean,
  _isOrganization: boolean
): { allowed: boolean; reason?: string } {
  // Note: isOrganization parameter kept for backwards compatibility but no longer restricts access
  // All plans can now create repos in personal accounts or organizations
  // Org-specific features (exposure, audit, permissions) are still gated on Team+ plans

  const limits = getPlanLimits(plan);

  if (isPrivate) {
    if (currentPrivateCount >= limits.maxPrivateRepos) {
      return {
        allowed: false,
        reason: `Your ${plan} plan allows ${limits.maxPrivateRepos} private repo${limits.maxPrivateRepos === 1 ? "" : "s"}. Upgrade to create more.`,
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
  return limit === Infinity ? "unlimited" : limit;
}

/**
 * Check if a plan allows connecting another provider
 */
export function canConnectProvider(
  plan: UserPlan,
  currentProviderCount: number
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  if (currentProviderCount >= limits.maxProviders) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows ${limits.maxProviders} provider connection${limits.maxProviders === 1 ? "" : "s"}. Upgrade to connect more providers.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a plan allows creating another environment in a vault
 */
export function canCreateEnvironment(
  plan: UserPlan,
  currentEnvironmentCount: number
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  if (currentEnvironmentCount >= limits.maxEnvironmentsPerVault) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows ${limits.maxEnvironmentsPerVault} environment${limits.maxEnvironmentsPerVault === 1 ? "" : "s"} per vault. Upgrade to create more.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a plan allows creating another secret in a private vault
 * Public vaults have no secret limit
 */
export function canCreateSecret(
  plan: UserPlan,
  currentSecretCount: number,
  isPrivateVault: boolean
): { allowed: boolean; reason?: string } {
  // Public vaults have no secret limit
  if (!isPrivateVault) {
    return { allowed: true };
  }

  const limits = getPlanLimits(plan);

  if (currentSecretCount >= limits.maxSecretsPerPrivateVault) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows ${limits.maxSecretsPerPrivateVault} secrets per private vault. Upgrade to add more secrets.`,
    };
  }

  return { allowed: true };
}
