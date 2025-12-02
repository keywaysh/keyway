import { db, vaults, secrets } from '../db';
import { eq, desc, and, asc } from 'drizzle-orm';
import { getRepoPermission, getRepoAccessAndPermission } from '../utils/github';
import type { UserPlan } from '../db/schema';
import { PLANS } from '../config/plans';

// Helper to get GitHub avatar URL for a repo owner
function getGitHubAvatarUrl(owner: string): string {
  return `https://github.com/${owner}.png`;
}

export interface VaultWithSecrets {
  id: string;
  repoFullName: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  secrets: Array<{
    id: string;
    environment: string;
  }>;
}

export interface VaultListItem {
  id: string;
  repoOwner: string;
  repoName: string;
  repoAvatar: string;
  secretCount: number;
  environments: string[];
  permission: string | null;
  isPrivate: boolean;
  isReadOnly: boolean;
  updatedAt: string;
}

export interface VaultDetails {
  id: string;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  repoAvatar: string;
  secretCount: number;
  environments: string[];
  permission: string | null;
  isPrivate: boolean;
  isReadOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get private vaults ordered by creation date for determining read-only status.
 * Returns a Set of excess vault IDs (vaults beyond the plan limit).
 */
async function getExcessPrivateVaultIds(userId: string, plan: UserPlan): Promise<Set<string>> {
  const limit = PLANS[plan].maxPrivateRepos;

  // If unlimited, no vaults are excess
  if (limit === Infinity) {
    return new Set();
  }

  // Get private vaults ordered by creation date (FIFO - oldest first)
  const privateVaults = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(and(eq(vaults.ownerId, userId), eq(vaults.isPrivate, true)))
    .orderBy(asc(vaults.createdAt));

  // Vaults beyond the limit are "excess" (read-only)
  return new Set(privateVaults.slice(limit).map(v => v.id));
}

/**
 * Get all vaults for a user with their metadata
 */
export async function getVaultsForUser(
  userId: string,
  accessToken: string,
  plan: UserPlan
): Promise<VaultListItem[]> {
  const ownedVaults = await db.query.vaults.findMany({
    where: eq(vaults.ownerId, userId),
    with: {
      secrets: true,
    },
    orderBy: [desc(vaults.updatedAt)],
  });

  // Get excess vault IDs for read-only determination
  const excessVaultIds = await getExcessPrivateVaultIds(userId, plan);

  const vaultList = await Promise.all(
    ownedVaults.map(async (vault) => {
      const [repoOwner, repoName] = vault.repoFullName.split('/');

      // Get unique environments from secrets
      const environments = [...new Set(vault.secrets.map((s) => s.environment))];
      if (environments.length === 0) {
        environments.push('default');
      }

      // Fetch user's permission for this repo
      const permission = await getRepoPermission(accessToken, vault.repoFullName);

      // Private vaults beyond plan limit are read-only
      const isReadOnly = vault.isPrivate && excessVaultIds.has(vault.id);

      return {
        id: vault.id,
        repoOwner,
        repoName,
        repoAvatar: getGitHubAvatarUrl(repoOwner),
        secretCount: vault.secrets.length,
        environments,
        permission,
        isPrivate: vault.isPrivate,
        isReadOnly,
        updatedAt: vault.updatedAt.toISOString(),
      };
    })
  );

  return vaultList;
}

/**
 * Get vault by repo full name with access check
 */
export async function getVaultByRepo(
  repoFullName: string,
  accessToken: string,
  plan: UserPlan
): Promise<{ vault: VaultDetails; hasAccess: boolean }> {
  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
    with: {
      secrets: true,
      owner: true,
    },
  });

  if (!vault) {
    return { vault: null as unknown as VaultDetails, hasAccess: false };
  }

  const { hasAccess, permission } = await getRepoAccessAndPermission(
    accessToken,
    vault.repoFullName
  );

  if (!hasAccess) {
    return { vault: null as unknown as VaultDetails, hasAccess: false };
  }

  const [repoOwner, repoName] = vault.repoFullName.split('/');

  // Get unique environments
  const environments = [...new Set(vault.secrets.map((s) => s.environment))];
  if (environments.length === 0) {
    environments.push('default');
  }

  // Determine if vault is read-only based on plan limits
  const excessVaultIds = await getExcessPrivateVaultIds(vault.ownerId, plan);
  const isReadOnly = vault.isPrivate && excessVaultIds.has(vault.id);

  return {
    vault: {
      id: vault.id,
      repoFullName: vault.repoFullName,
      repoOwner,
      repoName,
      repoAvatar: getGitHubAvatarUrl(repoOwner),
      secretCount: vault.secrets.length,
      environments,
      permission,
      isPrivate: vault.isPrivate,
      isReadOnly,
      createdAt: vault.createdAt.toISOString(),
      updatedAt: vault.updatedAt.toISOString(),
    },
    hasAccess: true,
  };
}

/**
 * Get vault by repo full name (internal, no access check)
 */
export async function getVaultByRepoInternal(repoFullName: string) {
  return db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
  });
}

/**
 * Update vault's updatedAt timestamp
 */
export async function touchVault(vaultId: string): Promise<void> {
  await db.update(vaults).set({ updatedAt: new Date() }).where(eq(vaults.id, vaultId));
}
