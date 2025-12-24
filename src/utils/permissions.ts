import { db } from '../db';
import { environmentPermissions, vaults, organizations } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import type { CollaboratorRole, PermissionType } from '../db/schema';
import { findApplicableOverride } from '../services/permission-override.service';
import { ForbiddenError } from '../lib';

// ============================================================================
// Role Hierarchy
// ============================================================================

/**
 * Role hierarchy (from lowest to highest)
 */
const ROLE_HIERARCHY: CollaboratorRole[] = ['read', 'triage', 'write', 'maintain', 'admin'];

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

export type EnvironmentType = 'protected' | 'standard' | 'development';

/**
 * Classify an environment name into a type
 */
export function getEnvironmentType(environment: string): EnvironmentType {
  const env = environment.toLowerCase();

  // Protected environments (production)
  if (['production', 'prod', 'main', 'master'].includes(env)) {
    return 'protected';
  }

  // Development environments
  if (['dev', 'development', 'local'].includes(env)) {
    return 'development';
  }

  // Standard environments (staging, test, qa, etc.)
  return 'standard';
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
 * | triage   | RW          | R                | -          |
 * | write    | RW          | RW               | R          |
 * | maintain | RW          | RW               | R          |
 * | admin    | RW          | RW               | RW         |
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
    development: { read: true, write: true },
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
    read: 'write',  // Need at least 'write' role to read
    write: 'admin', // Need 'admin' role to write
  },
  standard: {
    read: 'read',   // Anyone with 'read' or higher can read
    write: 'write', // Need 'write' or higher to write
  },
  development: {
    read: 'read',   // Anyone with 'read' or higher can read
    write: 'read',  // Anyone with 'read' or higher can write
  },
};

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
    return permissionType === 'read' ? override.canRead : override.canWrite;
  }

  // 2. Check for org-level default permissions
  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.id, vaultId),
    with: { organization: true },
  });

  if (vault?.organization?.defaultPermissions) {
    const orgDefaults = vault.organization.defaultPermissions as Record<
      CollaboratorRole,
      Record<EnvironmentType, { read: boolean; write: boolean }>
    >;
    const envType = getEnvironmentType(environment);

    // Check if org has custom defaults for this role/envType
    if (orgDefaults[userRole]?.[envType]?.[permissionType] !== undefined) {
      return orgDefaults[userRole][envType][permissionType];
    }
  }

  // 3. Fall back to global defaults
  const envType = getEnvironmentType(environment);
  const defaults = DEFAULT_ROLE_PERMISSIONS[userRole][envType];
  return permissionType === 'read' ? defaults.read : defaults.write;
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
  return permissionType === 'read' ? defaults.read : defaults.write;
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
      resolveEffectivePermission(vaultId, env, userId, userRole, 'read'),
      resolveEffectivePermission(vaultId, env, userId, userRole, 'write'),
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
    const action = permissionType === 'read' ? 'read secrets from' : 'write to';
    throw new ForbiddenError(
      `Your role (${userRole}) does not have permission to ${action} the "${environment}" environment`
    );
  }
}
