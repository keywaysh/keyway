import { db } from "../db";
import { environmentPermissions, vaults, vaultEnvironments } from "../db/schema";
import { eq, and } from "drizzle-orm";
import type {
  CollaboratorRole,
  PermissionType,
  EnvironmentType as DbEnvironmentType,
} from "../db/schema";
import { findApplicableOverride } from "../services/permission-override.service";
import { ForbiddenError } from "../lib";

// ============================================================================
// Role Hierarchy
// ============================================================================

/**
 * Role hierarchy (from lowest to highest)
 */
const ROLE_HIERARCHY: CollaboratorRole[] = ["read", "triage", "write", "maintain", "admin"];

/**
 * Check if userRole meets or exceeds requiredRole
 */
export function roleHasLevel(userRole: CollaboratorRole, requiredRole: CollaboratorRole): boolean {
  const userLevel = ROLE_HIERARCHY.indexOf(userRole);
  const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}

// ============================================================================
// Environment Classification
// ============================================================================

// Re-export the DB type for backward compatibility
export type EnvironmentType = DbEnvironmentType;

/**
 * Infer environment type from name (for initial detection / fallback)
 *
 * Used when:
 * - Creating a new environment (auto-detect initial type)
 * - Environment not yet in vault_environments table (fallback)
 *
 * Note: The stored type in vault_environments takes precedence.
 * This function is only for inference when no stored type exists.
 *
 * Handles compound formats like "production:serviceId" (Railway)
 */
export function inferEnvironmentType(environment: string): EnvironmentType {
  // Handle compound formats like "production:serviceId" (Railway)
  // Extract the base environment name before any colon
  const baseEnv = environment.split(":")[0].toLowerCase();

  // Protected environments (production)
  if (["production", "prod", "main", "master"].includes(baseEnv)) {
    return "protected";
  }

  // Development environments
  if (["dev", "development", "local"].includes(baseEnv)) {
    return "development";
  }

  // Standard environments (staging, test, qa, etc.)
  return "standard";
}

/**
 * @deprecated Use inferEnvironmentType for name-based detection
 * or getStoredEnvironmentType for explicit type lookup
 */
export const getEnvironmentType = inferEnvironmentType;

/**
 * Get the explicitly stored environment type from the database
 *
 * Resolution order:
 * 1. Look up in vault_environments table (explicit type)
 * 2. Fall back to name-based inference if not found
 *
 * @returns The environment type and whether it was from DB or inferred
 */
export async function getStoredEnvironmentType(
  vaultId: string,
  environmentName: string
): Promise<{ type: EnvironmentType; isExplicit: boolean }> {
  const stored = await db.query.vaultEnvironments.findFirst({
    where: and(eq(vaultEnvironments.vaultId, vaultId), eq(vaultEnvironments.name, environmentName)),
  });

  if (stored) {
    return { type: stored.type, isExplicit: true };
  }

  // Fall back to name-based inference
  return { type: inferEnvironmentType(environmentName), isExplicit: false };
}

// ============================================================================
// New Permission Matrix (by role and environment type)
// ============================================================================

/**
 * Default permissions matrix based on GitHub role and environment type
 *
 * | Role     | development | staging/standard | production |
 * |----------|-------------|------------------|------------|
 * | read     | R           | R                | -          |
 * | triage   | R           | R                | -          |
 * | write    | RW          | RW               | R          |
 * | maintain | RW          | RW               | R          |
 * | admin    | RW          | RW               | RW         |
 *
 * Note: triage role is read-only across all environments because
 * it's intended for issue/PR management, not code or secrets.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  CollaboratorRole,
  Record<EnvironmentType, { read: boolean; write: boolean }>
> = {
  read: {
    protected: { read: false, write: false },
    standard: { read: true, write: false },
    development: { read: true, write: false },
  },
  triage: {
    protected: { read: false, write: false },
    standard: { read: true, write: false },
    development: { read: true, write: false }, // triage role should not modify secrets
  },
  write: {
    protected: { read: true, write: false },
    standard: { read: true, write: true },
    development: { read: true, write: true },
  },
  maintain: {
    protected: { read: true, write: false },
    standard: { read: true, write: true },
    development: { read: true, write: true },
  },
  admin: {
    protected: { read: true, write: true },
    standard: { read: true, write: true },
    development: { read: true, write: true },
  },
};

// ============================================================================
// Legacy Permission Rules (for backwards compatibility)
// ============================================================================

/**
 * @deprecated Use DEFAULT_ROLE_PERMISSIONS instead
 * Default permission rules based on environment type (legacy format)
 */
const LEGACY_DEFAULT_PERMISSIONS: Record<
  EnvironmentType,
  Record<PermissionType, CollaboratorRole>
> = {
  protected: {
    read: "write", // Need at least 'write' role to read
    write: "admin", // Need 'admin' role to write
  },
  standard: {
    read: "read", // Anyone with 'read' or higher can read
    write: "write", // Need 'write' or higher to write
  },
  development: {
    read: "read", // Anyone with 'read' or higher can read
    write: "read", // Anyone with 'read' or higher can write
  },
};

// ============================================================================
// Organization Default Permissions Helpers
// ============================================================================

/**
 * Safely extract a permission from organization defaultPermissions JSONB
 *
 * Validates the structure at each level to prevent crashes from malformed data.
 * Returns null if the path doesn't exist or is invalid.
 */
function getOrgDefaultPermission(
  defaultPermissions: unknown,
  role: CollaboratorRole,
  envType: EnvironmentType,
  permissionType: PermissionType
): boolean | null {
  // Validate top-level is an object
  if (!defaultPermissions || typeof defaultPermissions !== "object") {
    return null;
  }

  const perms = defaultPermissions as Record<string, unknown>;

  // Validate role level exists and is an object
  const rolePerms = perms[role];
  if (!rolePerms || typeof rolePerms !== "object") {
    return null;
  }

  const envPerms = (rolePerms as Record<string, unknown>)[envType];

  // Validate environment level exists and is an object
  if (!envPerms || typeof envPerms !== "object") {
    return null;
  }

  const permission = (envPerms as Record<string, unknown>)[permissionType];

  // Validate final value is a boolean
  if (typeof permission !== "boolean") {
    return null;
  }

  return permission;
}

// ============================================================================
// Permission Resolution (New System with Overrides)
// ============================================================================

/**
 * Resolve the effective permission for a user on a vault/environment
 *
 * Resolution order (most specific to least specific):
 * 1. User-specific override (vault + env + userId)
 * 2. Role-specific override (vault + env + role)
 * 3. Org-level defaults (if vault belongs to an org)
 * 4. Global defaults (DEFAULT_ROLE_PERMISSIONS matrix)
 *
 * Environment type is resolved from vault_environments table (explicit)
 * with fallback to name-based inference if not stored.
 */
export async function resolveEffectivePermission(
  vaultId: string,
  environment: string,
  userId: string,
  userRole: CollaboratorRole,
  permissionType: PermissionType
): Promise<boolean> {
  // 1. Check for applicable override
  const override = await findApplicableOverride(vaultId, environment, userId, userRole);
  if (override) {
    return permissionType === "read" ? override.canRead : override.canWrite;
  }

  // Get environment type (explicit from DB or inferred from name)
  const { type: envType } = await getStoredEnvironmentType(vaultId, environment);

  // 2. Check for org-level default permissions
  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.id, vaultId),
    with: { organization: true },
  });

  if (vault?.organization?.defaultPermissions) {
    // Safely extract permission from JSONB with type validation
    const permission = getOrgDefaultPermission(
      vault.organization.defaultPermissions,
      userRole,
      envType,
      permissionType
    );
    if (permission !== null) {
      return permission;
    }
  }

  // 3. Fall back to global defaults
  const defaults = DEFAULT_ROLE_PERMISSIONS[userRole][envType];
  return permissionType === "read" ? defaults.read : defaults.write;
}

// ============================================================================
// Legacy Functions (for backwards compatibility)
// ============================================================================

/**
 * Check if user has permission to perform an action on an environment
 *
 * @deprecated Use resolveEffectivePermission for new code
 *
 * This function maintains backwards compatibility with the old system
 * that uses environment_permissions table (per-vault/env custom roles)
 */
export async function hasEnvironmentPermission(
  vaultId: string,
  environment: string,
  userRole: CollaboratorRole,
  permissionType: PermissionType
): Promise<boolean> {
  // First, check if there are custom permissions in the old table
  const customPermissions = await db
    .select()
    .from(environmentPermissions)
    .where(
      and(
        eq(environmentPermissions.vaultId, vaultId),
        eq(environmentPermissions.environment, environment),
        eq(environmentPermissions.permissionType, permissionType)
      )
    );

  // If custom permission exists in old table, use it
  if (customPermissions.length > 0) {
    const requiredRole = customPermissions[0].minRole;
    return roleHasLevel(userRole, requiredRole);
  }

  // Otherwise, use the new role-based defaults
  const envType = getEnvironmentType(environment);
  const defaults = DEFAULT_ROLE_PERMISSIONS[userRole][envType];
  return permissionType === "read" ? defaults.read : defaults.write;
}

/**
 * Get the default minimum role required for an environment/permission
 * Used for displaying defaults in API responses
 *
 * @deprecated Use DEFAULT_ROLE_PERMISSIONS directly
 */
export function getDefaultPermission(
  environment: string,
  permissionType: PermissionType
): CollaboratorRole {
  const envType = getEnvironmentType(environment);
  return LEGACY_DEFAULT_PERMISSIONS[envType][permissionType];
}

/**
 * Get all permission rules for a vault (custom + defaults for common environments)
 */
export async function getVaultPermissions(vaultId: string) {
  // Get custom permissions from old table
  const custom = await db
    .select()
    .from(environmentPermissions)
    .where(eq(environmentPermissions.vaultId, vaultId));

  // Return custom permissions with environment type classification
  const customWithDefaults = custom.map((perm) => ({
    ...perm,
    isCustom: true,
    environmentType: getEnvironmentType(perm.environment),
  }));

  return {
    custom: customWithDefaults,
    defaults: LEGACY_DEFAULT_PERMISSIONS,
    roleDefaults: DEFAULT_ROLE_PERMISSIONS,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the effective permissions for a user on all environments of a vault
 * Useful for displaying the permission matrix in the UI
 */
export async function getEffectivePermissionsForUser(
  vaultId: string,
  userId: string,
  userRole: CollaboratorRole,
  environments: string[]
): Promise<Record<string, { read: boolean; write: boolean }>> {
  const result: Record<string, { read: boolean; write: boolean }> = {};

  for (const env of environments) {
    const [canRead, canWrite] = await Promise.all([
      resolveEffectivePermission(vaultId, env, userId, userRole, "read"),
      resolveEffectivePermission(vaultId, env, userId, userRole, "write"),
    ]);
    result[env] = { read: canRead, write: canWrite };
  }

  return result;
}

/**
 * Get the default permissions for a role on all environment types
 * Useful for displaying what a role can do by default
 */
export function getDefaultPermissionsForRole(
  role: CollaboratorRole
): Record<EnvironmentType, { read: boolean; write: boolean }> {
  return DEFAULT_ROLE_PERMISSIONS[role];
}

// ============================================================================
// Permission Enforcement Helpers
// ============================================================================

/**
 * Check environment permission and throw ForbiddenError if denied
 *
 * This helper reduces boilerplate in routes by combining:
 * 1. resolveEffectivePermission call
 * 2. Error throwing with consistent message format
 *
 * @throws ForbiddenError if permission is denied
 */
export async function requireEnvironmentPermission(
  vaultId: string,
  environment: string,
  userId: string,
  userRole: CollaboratorRole,
  permissionType: PermissionType
): Promise<void> {
  const hasPermission = await resolveEffectivePermission(
    vaultId,
    environment,
    userId,
    userRole,
    permissionType
  );

  if (!hasPermission) {
    const action = permissionType === "read" ? "read secrets from" : "write to";
    throw new ForbiddenError(
      `Your role (${userRole}) does not have permission to ${action} the "${environment}" environment`
    );
  }
}

// ============================================================================
// Cross-Environment Sync Validation
// ============================================================================

/**
 * Environment protection levels (higher = more protected)
 */
const ENVIRONMENT_PROTECTION_LEVEL: Record<EnvironmentType, number> = {
  development: 0,
  standard: 1,
  protected: 2,
};

/**
 * Check if a sync operation between two environments is allowed based on role
 * Uses name-based type inference (for tests and simple cases)
 *
 * Rules:
 * - Syncing to a MORE protected environment requires admin role
 * - Syncing to SAME or LESS protected environment follows normal permissions
 *
 * Examples:
 * - dev → staging: Allowed for write+ (escalating protection)
 * - staging → prod: Requires admin
 * - prod → staging: Allowed for write+ (de-escalating)
 * - dev → prod: Requires admin (skipping protection level)
 *
 * @returns Object with allowed status and optional reason
 */
export function canSyncBetweenEnvironments(
  sourceEnv: string,
  targetEnv: string,
  userRole: CollaboratorRole
): { allowed: boolean; reason?: string } {
  const sourceType = inferEnvironmentType(sourceEnv);
  const targetType = inferEnvironmentType(targetEnv);

  return checkSyncProtectionLevels(sourceType, targetType, userRole);
}

/**
 * Check sync permission using explicit environment types
 * Use this when you have vault context and can look up stored types
 *
 * @param direction - "push" means Keyway→Provider, "pull" means Provider→Keyway
 */
export async function canSyncBetweenEnvironmentsAsync(
  vaultId: string,
  keywayEnv: string,
  providerEnv: string,
  direction: "push" | "pull",
  userRole: CollaboratorRole
): Promise<{ allowed: boolean; reason?: string }> {
  // Keyway env uses stored type, provider env uses inference (external)
  const { type: keywayType } = await getStoredEnvironmentType(vaultId, keywayEnv);
  const providerType = inferEnvironmentType(providerEnv);

  // Push: Keyway is source, Provider is target
  // Pull: Provider is source, Keyway is target
  const sourceType = direction === "push" ? keywayType : providerType;
  const targetType = direction === "push" ? providerType : keywayType;

  return checkSyncProtectionLevels(sourceType, targetType, userRole);
}

/**
 * Core sync protection check logic
 */
function checkSyncProtectionLevels(
  sourceType: EnvironmentType,
  targetType: EnvironmentType,
  userRole: CollaboratorRole
): { allowed: boolean; reason?: string } {
  const sourceLevel = ENVIRONMENT_PROTECTION_LEVEL[sourceType];
  const targetLevel = ENVIRONMENT_PROTECTION_LEVEL[targetType];

  // If syncing to a more protected environment, require admin
  if (targetLevel > sourceLevel && userRole !== "admin") {
    const sourceLabel = sourceType === "development" ? "development" : sourceType;
    const targetLabel = targetType === "protected" ? "production" : targetType;

    return {
      allowed: false,
      reason:
        `Syncing from ${sourceLabel} to ${targetLabel} requires admin role. ` +
        `Your role (${userRole}) cannot escalate secrets to a more protected environment.`,
    };
  }

  return { allowed: true };
}

/**
 * Validate sync operation permissions
 *
 * Combines:
 * 1. Cross-environment protection check (dev → prod requires admin)
 *    Uses stored environment type for Keyway env, inferred for provider env
 * 2. Standard environment permission check (read/write based on direction)
 *
 * @throws ForbiddenError if sync is not allowed
 */
export async function requireSyncPermission(
  vaultId: string,
  keywayEnv: string,
  providerEnv: string,
  direction: "push" | "pull",
  userId: string,
  userRole: CollaboratorRole
): Promise<void> {
  // 1. Check cross-environment protection using stored type for Keyway env
  const crossEnvCheck = await canSyncBetweenEnvironmentsAsync(
    vaultId,
    keywayEnv,
    providerEnv,
    direction,
    userRole
  );
  if (!crossEnvCheck.allowed) {
    throw new ForbiddenError(crossEnvCheck.reason!);
  }

  // 2. Check standard environment permissions
  // Push: need read on Keyway env (reading secrets to push)
  // Pull: need write on Keyway env (writing secrets from provider)
  const keywayPermission = direction === "push" ? "read" : "write";

  await requireEnvironmentPermission(vaultId, keywayEnv, userId, userRole, keywayPermission);
}
