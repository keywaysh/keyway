import { db, vaults, vaultEnvironments } from "../db";
import { eq, desc, and, asc } from "drizzle-orm";
import { getUserRoleWithApp } from "../utils/github";
import type { UserPlan, EnvironmentType } from "../db/schema";
import { PLANS } from "../config/plans";
import { DEFAULT_ENVIRONMENTS } from "../types";
import { getOrganizationById } from "./organization.service";
import { getEffectivePlanWithTrial } from "./trial.service";
import { inferEnvironmentType } from "../utils/permissions";
import { logger } from "../utils/sharedLogger";

// Reason why a vault is read-only
export type ReadonlyReason = "plan_limit_exceeded" | "org_free_plan" | null;

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

export interface VaultSyncInfo {
  id: string;
  provider: string;
  projectId: string;
  projectName: string | null;
  connectionId: string;
  keywayEnvironment: string;
  providerEnvironment: string;
  lastSyncedAt: string | null;
}

export interface VaultEnvironmentInfo {
  name: string;
  type: EnvironmentType;
  displayOrder: number;
}

export interface VaultListItem {
  id: string;
  repoOwner: string;
  repoName: string;
  repoAvatar: string;
  secretCount: number;
  environments: string[]; // Array of environment names for backwards compatibility
  environmentDetails: VaultEnvironmentInfo[]; // Full environment info with types
  permission: string | null;
  warning?: "repo_inaccessible";
  isPrivate: boolean;
  isReadOnly: boolean;
  readonlyReason: ReadonlyReason;
  syncs: VaultSyncInfo[];
  updatedAt: string;
}

export interface VaultDetails {
  id: string;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  repoAvatar: string;
  secretCount: number;
  environments: string[]; // Array of environment names for backwards compatibility
  environmentDetails: VaultEnvironmentInfo[]; // Full environment info with types
  permission: string | null;
  isPrivate: boolean;
  isReadOnly: boolean;
  readonlyReason: ReadonlyReason;
  syncs: VaultSyncInfo[];
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
  return new Set(privateVaults.slice(limit).map((v) => v.id));
}

/**
 * Get environments for a vault from vault_environments table
 * Falls back to creating default environments if none exist (pre-migration vaults)
 */
export async function getVaultEnvironments(vaultId: string): Promise<VaultEnvironmentInfo[]> {
  const envs = await db.query.vaultEnvironments.findMany({
    where: eq(vaultEnvironments.vaultId, vaultId),
    orderBy: [asc(vaultEnvironments.displayOrder), asc(vaultEnvironments.name)],
  });

  // If no environments exist, return defaults with inferred types
  if (envs.length === 0) {
    return DEFAULT_ENVIRONMENTS.map((name, index) => ({
      name,
      type: inferEnvironmentType(name),
      displayOrder: index,
    }));
  }

  return envs.map((env) => ({
    name: env.name,
    type: env.type,
    displayOrder: env.displayOrder,
  }));
}

/**
 * Get environment names for a vault (for simple list operations)
 */
export async function getVaultEnvironmentNames(vaultId: string): Promise<string[]> {
  const envs = await getVaultEnvironments(vaultId);
  return envs.map((e) => e.name);
}

/**
 * Get all vaults for a user with their metadata
 * Uses GitHub App token to check user's permission on each repo
 */
export async function getVaultsForUser(
  userId: string,
  username: string,
  plan: UserPlan
): Promise<VaultListItem[]> {
  const ownedVaults = await db.query.vaults.findMany({
    where: eq(vaults.ownerId, userId),
    with: {
      secrets: true,
      vaultSyncs: true,
    },
    orderBy: [desc(vaults.updatedAt)],
  });

  // Get excess vault IDs for read-only determination (only for personal vaults)
  const excessVaultIds = await getExcessPrivateVaultIds(userId, plan);

  // Cache org effective plans to avoid repeated lookups
  const orgPlanCache = new Map<string, UserPlan>();

  const vaultList = await Promise.all(
    ownedVaults.map(async (vault) => {
      const [repoOwner, repoName] = vault.repoFullName.split("/");

      // Get environments from vault_environments table
      const environments = await getVaultEnvironments(vault.id);

      // Fetch user's permission for this repo using GitHub App token
      let permission: string | null = null;
      let warning: VaultListItem["warning"];
      try {
        permission = await getUserRoleWithApp(vault.repoFullName, username);
      } catch (err) {
        logger.warn({ repo: vault.repoFullName, err }, "Failed to check repo access — repo may have been deleted");
        warning = "repo_inaccessible";
      }

      // Determine isReadOnly and reason based on vault type (org vs personal)
      let isReadOnly = false;
      let readonlyReason: ReadonlyReason = null;
      if (vault.isPrivate) {
        if (vault.orgId) {
          // Org vault: check org's effective plan
          let orgPlan = orgPlanCache.get(vault.orgId);
          if (!orgPlan) {
            const org = await getOrganizationById(vault.orgId);
            orgPlan = org ? getEffectivePlanWithTrial(org) : "free";
            orgPlanCache.set(vault.orgId, orgPlan);
          }
          // Org vaults are read-only only if org is on free plan
          if (orgPlan === "free") {
            isReadOnly = true;
            readonlyReason = "org_free_plan";
          }
        } else {
          // Personal vault: check if it's in the excess list
          if (excessVaultIds.has(vault.id)) {
            isReadOnly = true;
            readonlyReason = "plan_limit_exceeded";
          }
        }
      }

      // Get syncs with full details for sync button
      const syncs = vault.vaultSyncs.map((sync) => ({
        id: sync.id,
        provider: sync.provider,
        projectId: sync.providerProjectId,
        projectName: sync.providerProjectName,
        connectionId: sync.connectionId,
        keywayEnvironment: sync.keywayEnvironment,
        providerEnvironment: sync.providerEnvironment,
        lastSyncedAt: sync.lastSyncedAt?.toISOString() || null,
      }));

      return {
        id: vault.id,
        repoOwner,
        repoName,
        repoAvatar: getGitHubAvatarUrl(repoOwner),
        // Only count active secrets (not deleted)
        secretCount: vault.secrets.filter((s) => s.deletedAt === null).length,
        environments: environments.map((e) => e.name), // String array for backwards compatibility
        environmentDetails: environments, // Full environment info with types
        permission,
        ...(warning && { warning }),
        isPrivate: vault.isPrivate,
        isReadOnly,
        readonlyReason,
        syncs,
        updatedAt: vault.updatedAt.toISOString(),
      };
    })
  );

  return vaultList;
}

/**
 * Get vault by repo full name with access check
 * Uses GitHub App token to check user's permission
 */
export async function getVaultByRepo(
  repoFullName: string,
  username: string,
  plan: UserPlan
): Promise<{ vault: VaultDetails; hasAccess: boolean }> {
  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
    with: {
      secrets: true,
      owner: true,
      vaultSyncs: true,
    },
  });

  if (!vault) {
    return { vault: null as unknown as VaultDetails, hasAccess: false };
  }

  // Check user's role using GitHub App token
  const role = await getUserRoleWithApp(vault.repoFullName, username);

  if (!role) {
    return { vault: null as unknown as VaultDetails, hasAccess: false };
  }

  const [repoOwner, repoName] = vault.repoFullName.split("/");

  // Get environments from vault_environments table
  const environments = await getVaultEnvironments(vault.id);

  // Determine if vault is read-only and reason based on plan limits
  let isReadOnly = false;
  let readonlyReason: ReadonlyReason = null;
  if (vault.isPrivate) {
    if (vault.orgId) {
      // Org vault: read-only only if org is on free plan
      // Note: plan parameter is already the org's effective plan when called from route
      if (plan === "free") {
        isReadOnly = true;
        readonlyReason = "org_free_plan";
      }
    } else {
      // Personal vault: check if it's in the excess list
      const excessVaultIds = await getExcessPrivateVaultIds(vault.ownerId, plan);
      if (excessVaultIds.has(vault.id)) {
        isReadOnly = true;
        readonlyReason = "plan_limit_exceeded";
      }
    }
  }

  // Get syncs with full details for sync button
  const syncs = vault.vaultSyncs.map((sync) => ({
    id: sync.id,
    provider: sync.provider,
    projectId: sync.providerProjectId,
    projectName: sync.providerProjectName,
    connectionId: sync.connectionId,
    keywayEnvironment: sync.keywayEnvironment,
    providerEnvironment: sync.providerEnvironment,
    lastSyncedAt: sync.lastSyncedAt?.toISOString() || null,
  }));

  return {
    vault: {
      id: vault.id,
      repoFullName: vault.repoFullName,
      repoOwner,
      repoName,
      repoAvatar: getGitHubAvatarUrl(repoOwner),
      // Only count active secrets (not deleted)
      secretCount: vault.secrets.filter((s) => s.deletedAt === null).length,
      environments: environments.map((e) => e.name), // String array for backwards compatibility
      environmentDetails: environments, // Full environment info with types
      permission: role,
      isPrivate: vault.isPrivate,
      isReadOnly,
      readonlyReason,
      syncs,
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
