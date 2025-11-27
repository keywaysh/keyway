import { db, vaults, secrets } from '../db';
import { eq, desc } from 'drizzle-orm';
import { getRepoPermission, getRepoAccessAndPermission } from '../utils/github';

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
  createdAt: string;
  updatedAt: string;
}

/**
 * Get all vaults for a user with their metadata
 */
export async function getVaultsForUser(
  userId: string,
  accessToken: string
): Promise<VaultListItem[]> {
  const ownedVaults = await db.query.vaults.findMany({
    where: eq(vaults.ownerId, userId),
    with: {
      secrets: true,
    },
    orderBy: [desc(vaults.updatedAt)],
  });

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

      return {
        id: vault.id,
        repoOwner,
        repoName,
        repoAvatar: getGitHubAvatarUrl(repoOwner),
        secretCount: vault.secrets.length,
        environments,
        permission,
        isPrivate: vault.isPrivate,
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
  accessToken: string
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
