import { db } from "../db";
import { permissionOverrides } from "../db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import type { PermissionOverride, CollaboratorRole, OverrideTargetType } from "../db/schema";

// ============================================================================
// Types
// ============================================================================

export interface OverrideInfo {
  id: string;
  environment: string;
  targetType: OverrideTargetType;
  targetUser?: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
  targetRole?: CollaboratorRole;
  canRead: boolean;
  canWrite: boolean;
  createdBy: {
    id: string;
    username: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOverrideInput {
  vaultId: string;
  environment: string;
  targetType: OverrideTargetType;
  targetUserId?: string;
  targetRole?: CollaboratorRole;
  canRead: boolean;
  canWrite: boolean;
  createdBy: string;
}

export interface UpdateOverrideInput {
  canRead?: boolean;
  canWrite?: boolean;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new permission override
 */
export async function createOverride(input: CreateOverrideInput): Promise<PermissionOverride> {
  // Validate target
  if (input.targetType === "user" && !input.targetUserId) {
    throw new Error('targetUserId is required when targetType is "user"');
  }
  if (input.targetType === "role" && !input.targetRole) {
    throw new Error('targetRole is required when targetType is "role"');
  }

  try {
    const [override] = await db
      .insert(permissionOverrides)
      .values({
        vaultId: input.vaultId,
        environment: input.environment,
        targetType: input.targetType,
        targetUserId: input.targetType === "user" ? input.targetUserId : null,
        targetRole: input.targetType === "role" ? input.targetRole : null,
        canRead: input.canRead,
        canWrite: input.canWrite,
        createdBy: input.createdBy,
      })
      .returning();

    return override;
  } catch (error: unknown) {
    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes("permission_overrides_unique")) {
      throw new Error(
        "A permission override already exists for this vault, environment, and target"
      );
    }
    throw error;
  }
}

/**
 * Update an existing permission override
 */
export async function updateOverride(
  overrideId: string,
  updates: UpdateOverrideInput
): Promise<PermissionOverride> {
  const [updated] = await db
    .update(permissionOverrides)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(permissionOverrides.id, overrideId))
    .returning();

  return updated;
}

/**
 * Delete a permission override
 */
export async function deleteOverride(overrideId: string): Promise<void> {
  await db.delete(permissionOverrides).where(eq(permissionOverrides.id, overrideId));
}

/**
 * Delete all overrides for an environment
 */
export async function deleteOverridesForEnvironment(
  vaultId: string,
  environment: string
): Promise<void> {
  await db
    .delete(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.vaultId, vaultId),
        eq(permissionOverrides.environment, environment)
      )
    );
}

/**
 * Reset all overrides for a vault (return to defaults)
 */
export async function resetVaultOverrides(vaultId: string): Promise<void> {
  await db.delete(permissionOverrides).where(eq(permissionOverrides.vaultId, vaultId));
}

/**
 * Get a single override by ID
 */
export async function getOverrideById(overrideId: string): Promise<OverrideInfo | null> {
  const override = await db.query.permissionOverrides.findFirst({
    where: eq(permissionOverrides.id, overrideId),
    with: {
      targetUser: true,
      createdByUser: true,
    },
  });

  if (!override) {
    return null;
  }

  return formatOverride(override);
}

/**
 * Get all overrides for a vault
 */
export async function getOverridesForVault(vaultId: string): Promise<OverrideInfo[]> {
  const overrides = await db.query.permissionOverrides.findMany({
    where: eq(permissionOverrides.vaultId, vaultId),
    with: {
      targetUser: true,
      createdByUser: true,
    },
    orderBy: [desc(permissionOverrides.createdAt)],
  });

  return overrides.map(formatOverride);
}

/**
 * Get overrides for a specific environment
 */
export async function getOverridesForEnvironment(
  vaultId: string,
  environment: string
): Promise<OverrideInfo[]> {
  const overrides = await db.query.permissionOverrides.findMany({
    where: and(
      eq(permissionOverrides.vaultId, vaultId),
      or(eq(permissionOverrides.environment, environment), eq(permissionOverrides.environment, "*"))
    ),
    with: {
      targetUser: true,
      createdByUser: true,
    },
    orderBy: [desc(permissionOverrides.createdAt)],
  });

  return overrides.map(formatOverride);
}

// ============================================================================
// Permission Resolution
// ============================================================================

/**
 * Find the most specific override for a user/role/environment combination
 * Priority: user-specific > role-specific > wildcard environment
 */
export async function findApplicableOverride(
  vaultId: string,
  environment: string,
  userId: string,
  userRole: CollaboratorRole
): Promise<PermissionOverride | null> {
  // 1. Check for user-specific override (exact environment)
  const userOverrideExact = await db.query.permissionOverrides.findFirst({
    where: and(
      eq(permissionOverrides.vaultId, vaultId),
      eq(permissionOverrides.environment, environment),
      eq(permissionOverrides.targetType, "user"),
      eq(permissionOverrides.targetUserId, userId)
    ),
  });
  if (userOverrideExact) {
    return userOverrideExact;
  }

  // 2. Check for user-specific override (wildcard environment)
  const userOverrideWildcard = await db.query.permissionOverrides.findFirst({
    where: and(
      eq(permissionOverrides.vaultId, vaultId),
      eq(permissionOverrides.environment, "*"),
      eq(permissionOverrides.targetType, "user"),
      eq(permissionOverrides.targetUserId, userId)
    ),
  });
  if (userOverrideWildcard) {
    return userOverrideWildcard;
  }

  // 3. Check for role-specific override (exact environment)
  const roleOverrideExact = await db.query.permissionOverrides.findFirst({
    where: and(
      eq(permissionOverrides.vaultId, vaultId),
      eq(permissionOverrides.environment, environment),
      eq(permissionOverrides.targetType, "role"),
      eq(permissionOverrides.targetRole, userRole)
    ),
  });
  if (roleOverrideExact) {
    return roleOverrideExact;
  }

  // 4. Check for role-specific override (wildcard environment)
  const roleOverrideWildcard = await db.query.permissionOverrides.findFirst({
    where: and(
      eq(permissionOverrides.vaultId, vaultId),
      eq(permissionOverrides.environment, "*"),
      eq(permissionOverrides.targetType, "role"),
      eq(permissionOverrides.targetRole, userRole)
    ),
  });
  if (roleOverrideWildcard) {
    return roleOverrideWildcard;
  }

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function formatOverride(override: {
  id: string;
  environment: string;
  targetType: OverrideTargetType;
  targetUserId: string | null;
  targetRole: CollaboratorRole | null;
  canRead: boolean;
  canWrite: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  targetUser?: {
    id: string;
    username: string;
    avatarUrl: string | null;
  } | null;
  createdByUser?: {
    id: string;
    username: string;
  } | null;
}): OverrideInfo {
  return {
    id: override.id,
    environment: override.environment,
    targetType: override.targetType,
    targetUser: override.targetUser
      ? {
          id: override.targetUser.id,
          username: override.targetUser.username,
          avatarUrl: override.targetUser.avatarUrl,
        }
      : undefined,
    targetRole: override.targetRole ?? undefined,
    canRead: override.canRead,
    canWrite: override.canWrite,
    createdBy: override.createdByUser
      ? {
          id: override.createdByUser.id,
          username: override.createdByUser.username,
        }
      : null,
    createdAt: override.createdAt.toISOString(),
    updatedAt: override.updatedAt.toISOString(),
  };
}
