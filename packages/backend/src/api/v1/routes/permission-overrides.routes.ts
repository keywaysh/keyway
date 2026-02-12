import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateGitHub } from "../../../middleware/auth";
import { db, vaults, users, organizationMembers } from "../../../db";
import { eq, and } from "drizzle-orm";
import {
  sendData,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} from "../../../lib";
import { getUserRoleWithApp } from "../../../utils/github";
import {
  createOverride,
  updateOverride,
  deleteOverride,
  getOverridesForVault,
  getOverrideById,
  resetVaultOverrides,
} from "../../../services/permission-override.service";
import { getVaultEnvironmentNames } from "../../../services";
import {
  DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissionsForUser,
} from "../../../utils/permissions";
// Validation schemas
const collaboratorRoleSchema = z.enum(["read", "triage", "write", "maintain", "admin"]);
const targetTypeSchema = z.enum(["user", "role"]);

const createOverrideSchema = z
  .object({
    environment: z.string().min(1).max(50),
    targetType: targetTypeSchema,
    targetUserId: z.string().uuid().optional(),
    targetRole: collaboratorRoleSchema.optional(),
    canRead: z.boolean(),
    canWrite: z.boolean(),
  })
  .refine(
    (data) => {
      if (data.targetType === "user") {
        return !!data.targetUserId;
      }
      if (data.targetType === "role") {
        return !!data.targetRole;
      }
      return false;
    },
    {
      message:
        'targetUserId required when targetType is "user", targetRole required when targetType is "role"',
    }
  );

const updateOverrideSchema = z.object({
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
});

/**
 * Permission Override routes
 * These routes allow org owners and repo admins to customize permissions
 *
 * GET /api/v1/vaults/:owner/:repo/permissions/overrides - List all overrides
 * POST /api/v1/vaults/:owner/:repo/permissions/overrides - Create override
 * PUT /api/v1/vaults/:owner/:repo/permissions/overrides/:id - Update override
 * DELETE /api/v1/vaults/:owner/:repo/permissions/overrides/:id - Delete override
 * DELETE /api/v1/vaults/:owner/:repo/permissions/reset - Reset all overrides
 * GET /api/v1/vaults/:owner/:repo/permissions/effective - Get effective permissions for current user
 * GET /api/v1/vaults/:owner/:repo/permissions/defaults - Get default permission matrix
 */
export async function permissionOverridesRoutes(fastify: FastifyInstance) {
  /**
   * Check if user can manage permissions (is org owner or repo admin)
   */
  async function canManagePermissions(
    userId: string,
    vault: { id: string; orgId: string | null; repoFullName: string },
    username: string
  ): Promise<boolean> {
    // Check if user is repo admin
    const role = await getUserRoleWithApp(vault.repoFullName, username);
    if (role === "admin") {
      return true;
    }

    // Check if user is org owner
    if (vault.orgId) {
      const membership = await db.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.orgId, vault.orgId),
          eq(organizationMembers.userId, userId)
        ),
      });
      if (membership?.orgRole === "owner") {
        return true;
      }
    }

    return false;
  }

  /**
   * GET /:owner/:repo/permissions/overrides
   * List all permission overrides for a vault
   */
  fastify.get<{
    Params: { owner: string; repo: string };
  }>(
    "/:owner/:repo/permissions/overrides",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo } = request.params;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Check user has at least read access
      const role = await getUserRoleWithApp(repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      const overrides = await getOverridesForVault(vault.id);
      return sendData(
        reply,
        {
          overrides,
          defaults: DEFAULT_ROLE_PERMISSIONS,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /:owner/:repo/permissions/overrides
   * Create a new permission override
   */
  fastify.post<{
    Params: { owner: string; repo: string };
    Body: z.infer<typeof createOverrideSchema>;
  }>(
    "/:owner/:repo/permissions/overrides",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo } = request.params;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Validate body
      const body = createOverrideSchema.parse(request.body);

      // Get user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Check permission to manage overrides
      const canManage = await canManagePermissions(user.id, vault, vcsUser.username);
      if (!canManage) {
        throw new ForbiddenError(
          "Only organization owners or repository admins can manage permissions"
        );
      }

      // Validate target user exists if targeting a user
      if (body.targetType === "user" && body.targetUserId) {
        const targetUser = await db.query.users.findFirst({
          where: eq(users.id, body.targetUserId),
        });
        if (!targetUser) {
          throw new BadRequestError("Target user not found");
        }
      }

      // Create override
      let override;
      try {
        override = await createOverride({
          vaultId: vault.id,
          environment: body.environment,
          targetType: body.targetType,
          targetUserId: body.targetUserId,
          targetRole: body.targetRole,
          canRead: body.canRead,
          canWrite: body.canWrite,
          createdBy: user.id,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          throw new ConflictError(
            "A permission override already exists for this vault, environment, and target"
          );
        }
        throw error;
      }

      const overrideInfo = await getOverrideById(override.id);
      return sendData(reply, overrideInfo, { requestId: request.id });
    }
  );

  /**
   * PUT /:owner/:repo/permissions/overrides/:id
   * Update an existing permission override
   */
  fastify.put<{
    Params: { owner: string; repo: string; id: string };
    Body: z.infer<typeof updateOverrideSchema>;
  }>(
    "/:owner/:repo/permissions/overrides/:id",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo, id } = request.params;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Validate body
      const body = updateOverrideSchema.parse(request.body);

      if (body.canRead === undefined && body.canWrite === undefined) {
        throw new BadRequestError("At least one of canRead or canWrite must be provided");
      }

      // Get user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Check permission to manage overrides
      const canManage = await canManagePermissions(user.id, vault, vcsUser.username);
      if (!canManage) {
        throw new ForbiddenError(
          "Only organization owners or repository admins can manage permissions"
        );
      }

      // Check override exists and belongs to this vault
      const existing = await getOverrideById(id);
      if (!existing) {
        throw new NotFoundError("Permission override not found");
      }

      // Update override
      await updateOverride(id, body);
      const updated = await getOverrideById(id);
      return sendData(reply, updated, { requestId: request.id });
    }
  );

  /**
   * DELETE /:owner/:repo/permissions/overrides/:id
   * Delete a permission override
   */
  fastify.delete<{
    Params: { owner: string; repo: string; id: string };
  }>(
    "/:owner/:repo/permissions/overrides/:id",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo, id } = request.params;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Check permission to manage overrides
      const canManage = await canManagePermissions(user.id, vault, vcsUser.username);
      if (!canManage) {
        throw new ForbiddenError(
          "Only organization owners or repository admins can manage permissions"
        );
      }

      // Check override exists
      const existing = await getOverrideById(id);
      if (!existing) {
        throw new NotFoundError("Permission override not found");
      }

      await deleteOverride(id);
      return sendData(reply, { deleted: true }, { requestId: request.id });
    }
  );

  /**
   * DELETE /:owner/:repo/permissions/reset
   * Reset all permission overrides to defaults
   */
  fastify.delete<{
    Params: { owner: string; repo: string };
  }>(
    "/:owner/:repo/permissions/reset",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo } = request.params;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Check permission to manage overrides
      const canManage = await canManagePermissions(user.id, vault, vcsUser.username);
      if (!canManage) {
        throw new ForbiddenError(
          "Only organization owners or repository admins can manage permissions"
        );
      }

      await resetVaultOverrides(vault.id);
      return sendData(
        reply,
        {
          message: "All permission overrides have been reset to defaults",
          defaults: DEFAULT_ROLE_PERMISSIONS,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /:owner/:repo/permissions/effective
   * Get effective permissions for the current user on all environments
   */
  fastify.get<{
    Params: { owner: string; repo: string };
  }>(
    "/:owner/:repo/permissions/effective",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo } = request.params;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get vault with environments
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user's GitHub role
      const role = await getUserRoleWithApp(repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get effective permissions for all environments
      const environments = await getVaultEnvironmentNames(vault.id);
      const effective = await getEffectivePermissionsForUser(vault.id, user.id, role, environments);

      return sendData(
        reply,
        {
          role,
          permissions: effective,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /:owner/:repo/permissions/defaults
   * Get the default permission matrix
   */
  fastify.get<{
    Params: { owner: string; repo: string };
  }>(
    "/:owner/:repo/permissions/defaults",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      return sendData(
        reply,
        {
          matrix: DEFAULT_ROLE_PERMISSIONS,
          description: {
            roles: ["read", "triage", "write", "maintain", "admin"],
            environmentTypes: {
              protected: "Production environments (production, prod, main, master)",
              standard: "Standard environments (staging, test, qa, etc.)",
              development: "Development environments (dev, development, local)",
            },
          },
        },
        { requestId: request.id }
      );
    }
  );
}
