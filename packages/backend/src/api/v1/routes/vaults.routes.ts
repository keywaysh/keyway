import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticateGitHub,
  requireAdminAccess,
  requireApiKeyScope,
} from "../../../middleware/auth";
import {
  db,
  vaults,
  secrets,
  environmentPermissions,
  vaultEnvironments,
  permissionOverrides,
} from "../../../db";
import type { EnvironmentType } from "../../../db/schema";
import {
  ensureOrganizationExists,
  getTrialEligibility,
  getOrganizationById,
} from "../../../services/organization.service";
import { getEffectivePlanWithTrial } from "../../../services/trial.service";
import { getTokenForRepo } from "../../../utils/github";
import { eq, and } from "drizzle-orm";
import {
  getVaultPermissions,
  getDefaultPermission,
  requireEnvironmentPermission,
  inferEnvironmentType,
} from "../../../utils/permissions";
import { getOrThrowUser, getUserFromVcsUser, type VcsUser } from "../../../utils/user-lookup";
import type { CollaboratorRole } from "../../../db/schema";
import {
  sendData,
  sendPaginatedData,
  sendCreated,
  sendNoContent,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  PlanLimitError,
  buildPaginationMeta,
  parsePagination,
} from "../../../lib";
import { canCreateEnvironment, canCreateSecret } from "../../../config/plans";
import {
  getVaultsForUser,
  getVaultByRepo,
  getVaultByRepoInternal,
  getVaultEnvironments,
  touchVault,
  getSecretsForVault,
  getSecretsCount,
  upsertSecret,
  updateSecret,
  secretExists,
  getSecretById,
  getSecretValue,
  logActivity,
  extractRequestInfo,
  detectPlatform,
  checkVaultCreationAllowed,
  computeUserUsage,
  canWriteToVault,
  // Trash operations
  trashSecret,
  getTrashedSecrets,
  getTrashedSecretsCount,
  getTrashedSecretById,
  restoreSecret,
  permanentlyDeleteSecret,
  emptyTrash,
  recordSecretAccess,
  type RecordAccessContext,
} from "../../../services";
import {
  getSecretVersions,
  getSecretVersionValue,
  restoreSecretVersion,
} from "../../../services/secretVersion.service";
import { generateDeviceId } from "../../../services/security.service";
import {
  getRepoInfoWithApp,
  getRepoCollaboratorsWithApp,
  getUserRoleWithApp,
} from "../../../utils/github";
import { config } from "../../../config";
import { trackEvent, AnalyticsEvents } from "../../../utils/analytics";
import { repoFullNameSchema, DEFAULT_ENVIRONMENTS } from "../../../types";
import { getSecurityAlerts } from "../../../services/security.service";

// Security limits for secrets
const MAX_SECRET_KEY_LENGTH = 256;
const MAX_SECRET_VALUE_SIZE = 64 * 1024; // 64KB

// Schemas
const CreateVaultSchema = z.object({
  repoFullName: repoFullNameSchema,
});

const UpsertSecretSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(MAX_SECRET_KEY_LENGTH)
    .regex(/^[A-Z][A-Z0-9_]*$/, {
      message: "Key must be uppercase with underscores (e.g., DATABASE_URL)",
    }),
  value: z.string().max(MAX_SECRET_VALUE_SIZE, {
    message: `Secret value must not exceed ${MAX_SECRET_VALUE_SIZE} bytes (64KB)`,
  }),
  environment: z.string().min(1).max(50).default("default"),
});

const PatchSecretSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(MAX_SECRET_KEY_LENGTH)
      .regex(/^[A-Z][A-Z0-9_]*$/, {
        message: "Key must be uppercase with underscores (e.g., DATABASE_URL)",
      })
      .optional(),
    value: z
      .string()
      .max(MAX_SECRET_VALUE_SIZE, {
        message: `Secret value must not exceed ${MAX_SECRET_VALUE_SIZE} bytes (64KB)`,
      })
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.value !== undefined, {
    message: "At least one of name or value must be provided",
  });

const EnvironmentPermissionsSchema = z.object({
  permissions: z.object({
    read: z.enum(["read", "triage", "write", "maintain", "admin"]),
    write: z.enum(["read", "triage", "write", "maintain", "admin"]),
  }),
});

// Environment name validation: lowercase, alphanumeric + dash/underscore, 2-30 chars
const environmentNameSchema = z
  .string()
  .min(2, "Environment name must be at least 2 characters")
  .max(30, "Environment name must not exceed 30 characters")
  .regex(/^[a-z][a-z0-9_-]*$/, {
    message:
      "Environment name must be lowercase, start with a letter, and contain only letters, numbers, dashes, or underscores",
  });

const CreateEnvironmentSchema = z.object({
  name: environmentNameSchema,
});

const RenameEnvironmentSchema = z.object({
  newName: environmentNameSchema,
});

const UpdateEnvironmentTypeSchema = z.object({
  type: z.enum(["protected", "standard", "development"]),
});

/**
 * Vault routes
 * GET    /v1/vaults              - List vaults
 * POST   /v1/vaults              - Create vault (init)
 * GET    /v1/vaults/:owner/:repo - Get vault details
 *
 * Nested secrets:
 * GET    /v1/vaults/:owner/:repo/secrets           - List secrets
 * POST   /v1/vaults/:owner/:repo/secrets           - Create/update secret
 * PATCH  /v1/vaults/:owner/:repo/secrets/:secretId - Update secret
 * DELETE /v1/vaults/:owner/:repo/secrets/:secretId - Delete secret
 */
export async function vaultsRoutes(fastify: FastifyInstance) {
  /**
   * GET /
   * List all vaults for the authenticated user
   */
  fastify.get(
    "/",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const vcsUser = (request.vcsUser || request.githubUser) as VcsUser;
      const pagination = parsePagination(request.query);

      // Get user from database
      const user = await getUserFromVcsUser(vcsUser);
      if (!user) {
        return sendPaginatedData(reply, [], buildPaginationMeta(pagination, 0, 0), {
          requestId: request.id,
        });
      }

      const vaultList = await getVaultsForUser(user.id, vcsUser.username, user.plan);

      // Apply pagination (in-memory for now, could be optimized)
      const paginatedVaults = vaultList.slice(
        pagination.offset,
        pagination.offset + pagination.limit
      );

      return sendPaginatedData(
        reply,
        paginatedVaults,
        buildPaginationMeta(pagination, vaultList.length, paginatedVaults.length),
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /
   * Create a new vault (init)
   */
  fastify.post(
    "/",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const body = CreateVaultSchema.parse(request.body);
      const vcsUser = (request.vcsUser || request.githubUser) as VcsUser;

      // Get repo info from GitHub App to determine visibility
      const repoInfo = await getRepoInfoWithApp(body.repoFullName);
      if (!repoInfo) {
        throw new NotFoundError(
          `Repository '${body.repoFullName}' not found or you don't have access`
        );
      }

      // Get user from database - must exist from auth flow
      const user = await getOrThrowUser(vcsUser);

      // Check if repo owner is an organization and ensure it exists in DB
      const repoOwner = body.repoFullName.split("/")[0];
      let org = null;
      let trialEligibility = null;

      if (repoInfo.isOrganization) {
        // Get installation token for this repo to fetch org info
        const installToken = await getTokenForRepo(repoOwner, body.repoFullName.split("/")[1]);
        // Pass user.id to add them as org member automatically
        org = await ensureOrganizationExists(repoOwner, installToken, user.id);

        // Calculate trial eligibility for error response
        if (org) {
          trialEligibility = getTrialEligibility(org);
        }
      }

      // Determine effective plan: use org's plan (with trial) for org repos, otherwise user's plan
      const effectivePlan =
        org && repoInfo.isOrganization ? getEffectivePlanWithTrial(org) : user.plan;

      // Check plan limits before creating vault
      const limitCheck = await checkVaultCreationAllowed(
        user.id,
        effectivePlan,
        repoInfo.isPrivate,
        repoInfo.isOrganization
      );
      if (!limitCheck.allowed) {
        // Debug log
        fastify.log.info(
          {
            org: org?.login,
            trialEligibility,
            effectivePlan,
            isOrganization: repoInfo.isOrganization,
          },
          "Plan limit check failed - trial info"
        );

        // Include trial eligibility info in error for org repos
        throw new PlanLimitError(
          limitCheck.reason!,
          `${config.app.frontendUrl}/upgrade`,
          trialEligibility ?? undefined
        );
      }

      // Check if vault already exists
      const existingVault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, body.repoFullName),
      });

      if (existingVault) {
        throw new ConflictError("Vault already exists for this repository");
      }

      // Create vault with visibility info and org association
      const [vault] = await db
        .insert(vaults)
        .values({
          repoFullName: body.repoFullName,
          ownerId: user.id,
          orgId: org?.id ?? null,
          isPrivate: repoInfo.isPrivate,
        })
        .returning();

      // Create default environments in vault_environments table
      await db.insert(vaultEnvironments).values(
        DEFAULT_ENVIRONMENTS.map((name, index) => ({
          vaultId: vault.id,
          name,
          type: inferEnvironmentType(name),
          displayOrder: index,
        }))
      );

      // Recompute usage after creating vault
      await computeUserUsage(user.id);

      trackEvent(user.id, AnalyticsEvents.VAULT_INITIALIZED, {
        repoFullName: body.repoFullName,
        isPrivate: repoInfo.isPrivate,
      });

      await logActivity({
        userId: user.id,
        action: "vault_created",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: { repoFullName: body.repoFullName, isPrivate: repoInfo.isPrivate },
        ...extractRequestInfo(request),
      });

      fastify.log.info(
        {
          repoFullName: body.repoFullName,
          userId: user.id,
          vaultId: vault.id,
          isPrivate: repoInfo.isPrivate,
        },
        "Vault initialized"
      );

      return sendCreated(
        reply,
        {
          vaultId: vault.id,
          repoFullName: vault.repoFullName,
          message: "Vault initialized successfully",
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /:owner/:repo
   * Get vault details by owner/repo
   */
  fastify.get(
    "/:owner/:repo",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = (request.vcsUser || request.githubUser) as VcsUser;

      // Get user to determine plan for isReadOnly calculation
      const user = await getUserFromVcsUser(vcsUser);

      // Default to 'free' plan if user not found (shouldn't happen but safe fallback)
      const userPlan = user?.plan ?? "free";

      // Check if vault belongs to an organization - if so, use org's effective plan
      const vaultInfo = await getVaultByRepoInternal(repoFullName);
      let effectivePlan = userPlan;
      if (vaultInfo?.orgId) {
        const org = await getOrganizationById(vaultInfo.orgId);
        if (org) {
          effectivePlan = getEffectivePlanWithTrial(org);
        }
      }

      const { vault, hasAccess } = await getVaultByRepo(
        repoFullName,
        vcsUser.username,
        effectivePlan
      );

      if (!vault || !hasAccess) {
        throw new NotFoundError(`Vault '${repoFullName}' not found or you don't have access`);
      }

      return sendData(reply, vault, { requestId: request.id });
    }
  );

  /**
   * DELETE /:owner/:repo
   * Delete a vault and all its secrets
   */
  fastify.delete(
    "/:owner/:repo",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("delete:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      fastify.log.info({ repoFullName }, "Deleting vault - step 1: finding vault");

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      fastify.log.info(
        { repoFullName, vaultId: vault.id },
        "Deleting vault - step 2: finding user"
      );

      const user = await getOrThrowUser(vcsUser);

      fastify.log.info(
        { repoFullName, vaultId: vault.id },
        "Deleting vault - step 3: deleting secrets"
      );

      // Delete all secrets first
      await db.delete(secrets).where(eq(secrets.vaultId, vault.id));

      fastify.log.info(
        { repoFullName, vaultId: vault.id },
        "Deleting vault - step 4: deleting vault"
      );

      // Delete the vault
      await db.delete(vaults).where(eq(vaults.id, vault.id));

      fastify.log.info({ repoFullName }, "Deleting vault - step 5: logging activity");

      await logActivity({
        userId: user.id,
        action: "vault_deleted",
        platform: detectPlatform(request),
        vaultId: null, // Vault already deleted, can't reference it
        metadata: { repoFullName },
        ...extractRequestInfo(request),
      });

      trackEvent(user.id, AnalyticsEvents.VAULT_INITIALIZED, {
        repoFullName,
        action: "deleted",
      });

      // Recompute usage after deleting vault
      await computeUserUsage(user.id);

      fastify.log.info({ repoFullName, userId: user.id }, "Vault deleted successfully");

      return sendNoContent(reply);
    }
  );

  /**
   * GET /:owner/:repo/secrets
   * List secrets for a vault
   */
  fastify.get(
    "/:owner/:repo/secrets",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;
      const pagination = parsePagination(request.query);

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get total count and paginated secrets efficiently
      const [totalCount, paginatedSecrets] = await Promise.all([
        getSecretsCount(vault.id),
        getSecretsForVault(vault.id, {
          limit: pagination.limit,
          offset: pagination.offset,
        }),
      ]);

      return sendPaginatedData(
        reply,
        paginatedSecrets,
        buildPaginationMeta(pagination, totalCount, paginatedSecrets.length),
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /:owner/:repo/secrets
   * Create or update a secret
   */
  fastify.post(
    "/:owner/:repo/secrets",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const body = UpsertSecretSchema.parse(request.body);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role using GitHub App
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Check environment-level write permission (uses override system)
      await requireEnvironmentPermission(vault.id, body.environment, user.id, role, "write");

      // Check plan limit for write access (soft limit for downgraded users)
      const writeCheck = await canWriteToVault(user.id, user.plan, vault.id, vault.isPrivate);
      if (!writeCheck.allowed) {
        throw new PlanLimitError(writeCheck.reason!);
      }

      // Check secret count limit for private vaults (only for new secrets, not updates)
      if (vault.isPrivate) {
        const exists = await secretExists(vault.id, body.key, body.environment);
        if (!exists) {
          const currentCount = await getSecretsCount(vault.id);
          const secretCheck = canCreateSecret(user.plan, currentCount, vault.isPrivate);
          if (!secretCheck.allowed) {
            throw new PlanLimitError(secretCheck.reason!);
          }
        }
      }

      const result = await upsertSecret({
        vaultId: vault.id,
        key: body.key,
        value: body.value,
        environment: body.environment,
        userId: user.id,
      });

      await touchVault(vault.id);

      const action = result.status === "created" ? "secret_created" : "secret_updated";
      await logActivity({
        userId: user.id,
        action,
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          key: body.key,
          environment: body.environment,
          repoFullName: vault.repoFullName,
        },
        ...extractRequestInfo(request),
      });

      trackEvent(user.id, AnalyticsEvents.SECRETS_PUSHED, {
        repoFullName: vault.repoFullName,
        environment: body.environment,
        action: result.status,
      });

      if (result.status === "created") {
        return sendCreated(reply, result, { requestId: request.id });
      }
      return sendData(reply, result, { requestId: request.id });
    }
  );

  /**
   * PATCH /:owner/:repo/secrets/:secretId
   * Update a secret
   */
  fastify.patch(
    "/:owner/:repo/secrets/:secretId",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; secretId: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const body = PatchSecretSchema.parse(request.body);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role using GitHub App
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get the existing secret to check its environment for permission
      const existingSecret = await getSecretById(params.secretId, vault.id);
      if (!existingSecret) {
        throw new NotFoundError("Secret not found");
      }

      // Check environment-level write permission (uses override system)
      await requireEnvironmentPermission(
        vault.id,
        existingSecret.environment,
        user.id,
        role,
        "write"
      );

      // Check plan limit for write access (soft limit for downgraded users)
      const writeCheck = await canWriteToVault(user.id, user.plan, vault.id, vault.isPrivate);
      if (!writeCheck.allowed) {
        throw new PlanLimitError(writeCheck.reason!);
      }

      const updatedSecret = await updateSecret(params.secretId, vault.id, {
        key: body.name,
        value: body.value,
        userId: user.id,
      });

      if (!updatedSecret) {
        throw new NotFoundError("Secret not found");
      }

      await logActivity({
        userId: user.id,
        action: "secret_updated",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          key: updatedSecret.key,
          environment: updatedSecret.environment,
          repoFullName: vault.repoFullName,
        },
        ...extractRequestInfo(request),
      });

      return sendData(reply, updatedSecret, { requestId: request.id });
    }
  );

  /**
   * DELETE /:owner/:repo/secrets/:secretId
   * Move a secret to trash (soft-delete)
   * Returns info for toast with undo capability
   */
  fastify.delete(
    "/:owner/:repo/secrets/:secretId",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("delete:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; secretId: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role using GitHub App
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get the existing secret to check its environment for permission
      const existingSecret = await getSecretById(params.secretId, vault.id);
      if (!existingSecret) {
        throw new NotFoundError("Secret not found");
      }

      // Check environment-level write permission (uses override system)
      await requireEnvironmentPermission(
        vault.id,
        existingSecret.environment,
        user.id,
        role,
        "write"
      );

      // Check plan limit for write access (soft limit for downgraded users)
      const writeCheck = await canWriteToVault(user.id, user.plan, vault.id, vault.isPrivate);
      if (!writeCheck.allowed) {
        throw new PlanLimitError(writeCheck.reason!);
      }

      // Soft-delete: move to trash
      const trashedSecret = await trashSecret(params.secretId, vault.id);
      if (!trashedSecret) {
        throw new NotFoundError("Secret not found");
      }

      await touchVault(vault.id);

      await logActivity({
        userId: user.id,
        action: "secret_trashed",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          key: trashedSecret.key,
          environment: trashedSecret.environment,
          repoFullName: vault.repoFullName,
          expiresAt: trashedSecret.expiresAt.toISOString(),
        },
        ...extractRequestInfo(request),
      });

      // Return info for toast/undo (not 204)
      return sendData(
        reply,
        {
          id: params.secretId,
          key: trashedSecret.key,
          environment: trashedSecret.environment,
          deletedAt: trashedSecret.deletedAt.toISOString(),
          expiresAt: trashedSecret.expiresAt.toISOString(),
          message: "Secret moved to trash",
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /:owner/:repo/secrets/:secretId/value
   * Get the decrypted value and preview of a secret
   * Used for secure reveal/copy functionality in dashboard
   *
   * Rate limited to 10 requests per minute to prevent enumeration attacks
   */
  fastify.get(
    "/:owner/:repo/secrets/:secretId/value",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; secretId: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role using GitHub App
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get the secret to check its environment for permission
      const secretData = await getSecretValue(params.secretId, vault.id);
      if (!secretData) {
        throw new NotFoundError("Secret not found");
      }

      // Check environment-level read permission (uses override system)
      await requireEnvironmentPermission(vault.id, secretData.environment, user.id, role, "read");

      if (user) {
        await logActivity({
          userId: user.id,
          action: "secret_value_accessed",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: {
            secretId: params.secretId,
            key: secretData.key,
            environment: secretData.environment,
            repoFullName: vault.repoFullName,
          },
          ...extractRequestInfo(request),
        });

        // Fire-and-forget exposure tracking - record this secret access
        const deviceId = generateDeviceId(
          request.headers["user-agent"] || null,
          request.ip || "unknown"
        );
        const accessCtx: RecordAccessContext = {
          userId: user.id,
          username: vcsUser.username,
          userAvatarUrl: vcsUser.avatarUrl,
          vaultId: vault.id,
          repoFullName: vault.repoFullName,
          environment: secretData.environment,
          githubRole: role,
          platform: detectPlatform(request),
          ipAddress: request.ip,
          deviceId,
        };
        fastify.log.info(
          { userId: user.id, secretId: params.secretId },
          "Recording secret access for exposure"
        );
        recordSecretAccess(accessCtx, {
          secretId: params.secretId,
          secretKey: secretData.key,
        })
          .then(() => {
            fastify.log.info({ secretId: params.secretId }, "Exposure tracking succeeded");
          })
          .catch((err) => {
            fastify.log.error({ err, secretId: params.secretId }, "Exposure tracking failed");
          });
      }

      return sendData(
        reply,
        {
          value: secretData.value,
          preview: secretData.preview,
        },
        { requestId: request.id }
      );
    }
  );

  // ============================================
  // Secret version history routes
  // ============================================

  /**
   * GET /:owner/:repo/secrets/:secretId/versions
   * Get version history for a secret (metadata only, no values)
   */
  fastify.get(
    "/:owner/:repo/secrets/:secretId/versions",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; secretId: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Verify secret exists and belongs to this vault
      const secret = await getSecretById(params.secretId, vault.id);
      if (!secret) {
        throw new NotFoundError("Secret not found");
      }

      const versions = await getSecretVersions(params.secretId, vault.id);

      return sendData(reply, { versions }, { requestId: request.id });
    }
  );

  /**
   * GET /:owner/:repo/secrets/:secretId/versions/:versionId/value
   * Get decrypted value of a specific version
   *
   * Rate limited to 10 requests per minute to prevent enumeration attacks
   */
  fastify.get(
    "/:owner/:repo/secrets/:secretId/versions/:versionId/value",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const params = request.params as {
        owner: string;
        repo: string;
        secretId: string;
        versionId: string;
      };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Verify secret exists and belongs to this vault
      const secret = await getSecretById(params.secretId, vault.id);
      if (!secret) {
        throw new NotFoundError("Secret not found");
      }

      // Check environment-level read permission (uses override system)
      await requireEnvironmentPermission(vault.id, secret.environment, user.id, role, "read");

      const versionData = await getSecretVersionValue(params.versionId, params.secretId, vault.id);
      if (!versionData) {
        throw new NotFoundError("Version not found");
      }

      // Log version value access
      await logActivity({
        userId: user.id,
        action: "secret_version_value_accessed",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          secretId: params.secretId,
          versionId: params.versionId,
          versionNumber: versionData.versionNumber,
          key: secret.key,
          repoFullName: vault.repoFullName,
        },
        ...extractRequestInfo(request),
      });

      return sendData(reply, versionData, { requestId: request.id });
    }
  );

  /**
   * POST /:owner/:repo/secrets/:secretId/versions/:versionId/restore
   * Restore a secret to a previous version
   */
  fastify.post(
    "/:owner/:repo/secrets/:secretId/versions/:versionId/restore",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const params = request.params as {
        owner: string;
        repo: string;
        secretId: string;
        versionId: string;
      };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Verify secret exists and belongs to this vault
      const secret = await getSecretById(params.secretId, vault.id);
      if (!secret) {
        throw new NotFoundError("Secret not found");
      }

      // Check environment-level write permission (uses override system)
      await requireEnvironmentPermission(vault.id, secret.environment, user.id, role, "write");

      // Check plan limit for write access (soft limit for downgraded users)
      const writeCheck = await canWriteToVault(user.id, user.plan, vault.id, vault.isPrivate);
      if (!writeCheck.allowed) {
        throw new PlanLimitError(writeCheck.reason!);
      }

      const result = await restoreSecretVersion(
        params.versionId,
        params.secretId,
        vault.id,
        user.id
      );
      if (!result) {
        throw new NotFoundError("Version not found");
      }

      await logActivity({
        userId: user.id,
        action: "secret_version_restored",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          key: result.key,
          versionNumber: result.versionNumber,
          repoFullName: vault.repoFullName,
        },
        ...extractRequestInfo(request),
      });

      return sendData(
        reply,
        {
          message: `Restored to version ${result.versionNumber}`,
          key: result.key,
          versionNumber: result.versionNumber,
        },
        { requestId: request.id }
      );
    }
  );

  // ============================================
  // Trash routes (soft-deleted secrets)
  // ============================================

  /**
   * GET /:owner/:repo/trash
   * List trashed secrets for a vault
   */
  fastify.get(
    "/:owner/:repo/trash",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;
      const pagination = parsePagination(request.query);

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      const [totalCount, trashedSecrets] = await Promise.all([
        getTrashedSecretsCount(vault.id),
        getTrashedSecrets(vault.id, {
          limit: pagination.limit,
          offset: pagination.offset,
        }),
      ]);

      return sendPaginatedData(
        reply,
        trashedSecrets,
        buildPaginationMeta(pagination, totalCount, trashedSecrets.length),
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /:owner/:repo/trash/:secretId/restore
   * Restore a secret from trash
   */
  fastify.post(
    "/:owner/:repo/trash/:secretId/restore",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; secretId: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get the trashed secret to check its environment for permission
      const trashedSecret = await getTrashedSecretById(params.secretId, vault.id);
      if (!trashedSecret) {
        throw new NotFoundError("Secret not found in trash");
      }

      // Check environment-level write permission (uses override system)
      await requireEnvironmentPermission(
        vault.id,
        trashedSecret.environment,
        user.id,
        role,
        "write"
      );

      // Check plan limit for write access
      const writeCheck = await canWriteToVault(user.id, user.plan, vault.id, vault.isPrivate);
      if (!writeCheck.allowed) {
        throw new PlanLimitError(writeCheck.reason!);
      }

      try {
        const restoredSecret = await restoreSecret(params.secretId, vault.id);
        if (!restoredSecret) {
          throw new NotFoundError("Failed to restore secret");
        }

        await touchVault(vault.id);

        await logActivity({
          userId: user.id,
          action: "secret_restored",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: {
            key: restoredSecret.key,
            environment: restoredSecret.environment,
            repoFullName: vault.repoFullName,
          },
          ...extractRequestInfo(request),
        });

        return sendData(
          reply,
          {
            id: restoredSecret.id,
            key: restoredSecret.key,
            environment: restoredSecret.environment,
            message: "Secret restored from trash",
          },
          { requestId: request.id }
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    }
  );

  /**
   * DELETE /:owner/:repo/trash/:secretId
   * Permanently delete a secret from trash
   */
  fastify.delete(
    "/:owner/:repo/trash/:secretId",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("delete:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; secretId: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first (needed for permission resolution)
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get the trashed secret to check its environment for permission
      const trashedSecret = await getTrashedSecretById(params.secretId, vault.id);
      if (!trashedSecret) {
        throw new NotFoundError("Secret not found in trash");
      }

      // Check environment-level write permission (uses override system)
      await requireEnvironmentPermission(
        vault.id,
        trashedSecret.environment,
        user.id,
        role,
        "write"
      );

      const deletedSecret = await permanentlyDeleteSecret(params.secretId, vault.id);
      if (!deletedSecret) {
        throw new NotFoundError("Failed to delete secret");
      }

      await touchVault(vault.id);

      await logActivity({
        userId: user.id,
        action: "secret_permanently_deleted",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          key: deletedSecret.key,
          environment: deletedSecret.environment,
          repoFullName: vault.repoFullName,
        },
        ...extractRequestInfo(request),
      });

      return sendNoContent(reply);
    }
  );

  /**
   * DELETE /:owner/:repo/trash
   * Empty all trash for a vault (permanently delete all trashed secrets)
   */
  fastify.delete(
    "/:owner/:repo/trash",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("delete:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user from database first
      const user = await getOrThrowUser(vcsUser);

      // Check GitHub role - require admin for bulk trash operations
      // This is because emptying trash affects multiple environments
      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }
      if (role !== "admin") {
        throw new ForbiddenError(
          "Only repository admins can empty the entire trash. Use individual delete for specific secrets."
        );
      }

      const result = await emptyTrash(vault.id);

      if (result.deleted > 0) {
        await touchVault(vault.id);

        await logActivity({
          userId: user.id,
          action: "secret_permanently_deleted",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: {
            count: result.deleted,
            keys: result.keys,
            repoFullName: vault.repoFullName,
            bulk: true,
          },
          ...extractRequestInfo(request),
        });
      }

      return sendData(
        reply,
        {
          deleted: result.deleted,
          message:
            result.deleted > 0
              ? `Permanently deleted ${result.deleted} secret(s)`
              : "Trash is already empty",
        },
        { requestId: request.id }
      );
    }
  );

  // ============================================
  // Environment routes
  // ============================================

  /**
   * GET /:owner/:repo/environments
   * List all environments for a vault with their types
   */
  fastify.get(
    "/:owner/:repo/environments",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      // Get environments from vault_environments table
      const environments = await getVaultEnvironments(vault.id);

      return sendData(reply, { environments }, { requestId: request.id });
    }
  );

  /**
   * POST /:owner/:repo/environments
   * Create a new environment
   */
  fastify.post(
    "/:owner/:repo/environments",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const body = CreateEnvironmentSchema.parse(request.body);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get user for plan check
      const user = await getOrThrowUser(vcsUser);

      // Get current environments from table
      const currentEnvs = await getVaultEnvironments(vault.id);

      // Check plan limit for environments
      const envCheck = canCreateEnvironment(user.plan, currentEnvs.length);
      if (!envCheck.allowed) {
        throw new PlanLimitError(envCheck.reason!);
      }

      // Check for duplicates
      if (currentEnvs.some((e) => e.name === body.name)) {
        throw new ConflictError(`Environment '${body.name}' already exists`);
      }

      // Calculate display order (add at end)
      const maxOrder = Math.max(...currentEnvs.map((e) => e.displayOrder), -1);

      // Insert new environment into vault_environments table
      const [newEnv] = await db
        .insert(vaultEnvironments)
        .values({
          vaultId: vault.id,
          name: body.name,
          type: inferEnvironmentType(body.name),
          displayOrder: maxOrder + 1,
        })
        .returning();

      // Update vault timestamp
      await db.update(vaults).set({ updatedAt: new Date() }).where(eq(vaults.id, vault.id));

      // Log activity
      await logActivity({
        userId: user.id,
        action: "environment_created",
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: { environment: body.name, type: newEnv.type, repoFullName },
        ...extractRequestInfo(request),
      });

      fastify.log.info(
        { repoFullName, environment: body.name, type: newEnv.type },
        "Environment created"
      );

      // Get updated environments list
      const updatedEnvs = await getVaultEnvironments(vault.id);

      return sendCreated(
        reply,
        {
          environment: { name: newEnv.name, type: newEnv.type, displayOrder: newEnv.displayOrder },
          environments: updatedEnvs,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * PATCH /:owner/:repo/environments/:name
   * Rename an environment
   */
  fastify.patch(
    "/:owner/:repo/environments/:name",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; name: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const oldName = params.name;
      const body = RenameEnvironmentSchema.parse(request.body);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get current environments from table
      const currentEnvs = await getVaultEnvironments(vault.id);
      const currentEnvNames = currentEnvs.map((e) => e.name);

      // Check old name exists
      if (!currentEnvNames.includes(oldName)) {
        throw new NotFoundError(`Environment '${oldName}' not found`);
      }

      // Check new name doesn't already exist
      if (currentEnvNames.includes(body.newName)) {
        throw new ConflictError(`Environment '${body.newName}' already exists`);
      }

      // Perform all updates in a transaction
      await db.transaction(async (tx) => {
        // Update vault_environments table
        await tx
          .update(vaultEnvironments)
          .set({ name: body.newName, updatedAt: new Date() })
          .where(and(eq(vaultEnvironments.vaultId, vault.id), eq(vaultEnvironments.name, oldName)));

        // Update all secrets with old environment name
        await tx
          .update(secrets)
          .set({ environment: body.newName, updatedAt: new Date() })
          .where(and(eq(secrets.vaultId, vault.id), eq(secrets.environment, oldName)));

        // Update environment permissions if any
        await tx
          .update(environmentPermissions)
          .set({ environment: body.newName, updatedAt: new Date() })
          .where(
            and(
              eq(environmentPermissions.vaultId, vault.id),
              eq(environmentPermissions.environment, oldName)
            )
          );

        // Update permission overrides if any
        await tx
          .update(permissionOverrides)
          .set({ environment: body.newName, updatedAt: new Date() })
          .where(
            and(
              eq(permissionOverrides.vaultId, vault.id),
              eq(permissionOverrides.environment, oldName)
            )
          );

        // Update vault timestamp
        await tx.update(vaults).set({ updatedAt: new Date() }).where(eq(vaults.id, vault.id));
      });

      // Log activity
      const user = await getUserFromVcsUser(vcsUser);
      if (user) {
        await logActivity({
          userId: user.id,
          action: "environment_renamed",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: { oldName, newName: body.newName, repoFullName },
          ...extractRequestInfo(request),
        });
      }

      fastify.log.info({ repoFullName, oldName, newName: body.newName }, "Environment renamed");

      // Get updated environments list
      const updatedEnvs = await getVaultEnvironments(vault.id);

      return sendData(
        reply,
        {
          oldName,
          newName: body.newName,
          environments: updatedEnvs,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * DELETE /:owner/:repo/environments/:name
   * Delete an environment and all its secrets
   */
  fastify.delete(
    "/:owner/:repo/environments/:name",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("delete:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; name: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const envName = params.name;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get current environments from table
      const currentEnvs = await getVaultEnvironments(vault.id);
      const currentEnvNames = currentEnvs.map((e) => e.name);

      // Check environment exists
      if (!currentEnvNames.includes(envName)) {
        throw new NotFoundError(`Environment '${envName}' not found`);
      }

      // Prevent deleting the last environment
      if (currentEnvs.length === 1) {
        throw new ForbiddenError("Cannot delete the last environment");
      }

      // Perform all updates in a transaction
      await db.transaction(async (tx) => {
        // Delete from vault_environments table
        await tx
          .delete(vaultEnvironments)
          .where(and(eq(vaultEnvironments.vaultId, vault.id), eq(vaultEnvironments.name, envName)));

        // Delete all secrets in this environment
        await tx
          .delete(secrets)
          .where(and(eq(secrets.vaultId, vault.id), eq(secrets.environment, envName)));

        // Delete environment permissions
        await tx
          .delete(environmentPermissions)
          .where(
            and(
              eq(environmentPermissions.vaultId, vault.id),
              eq(environmentPermissions.environment, envName)
            )
          );

        // Delete permission overrides
        await tx
          .delete(permissionOverrides)
          .where(
            and(
              eq(permissionOverrides.vaultId, vault.id),
              eq(permissionOverrides.environment, envName)
            )
          );

        // Update vault timestamp
        await tx.update(vaults).set({ updatedAt: new Date() }).where(eq(vaults.id, vault.id));
      });

      // Log activity
      const user = await getUserFromVcsUser(vcsUser);
      if (user) {
        await logActivity({
          userId: user.id,
          action: "environment_deleted",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: { environment: envName, repoFullName },
          ...extractRequestInfo(request),
        });
      }

      fastify.log.info({ repoFullName, environment: envName }, "Environment deleted");

      // Get updated environments list
      const updatedEnvs = await getVaultEnvironments(vault.id);

      return sendData(
        reply,
        {
          deleted: envName,
          environments: updatedEnvs,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * PATCH /:owner/:repo/environments/:name/type
   * Update the protection type of an environment
   */
  fastify.patch(
    "/:owner/:repo/environments/:name/type",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; name: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const envName = params.name;
      const body = UpdateEnvironmentTypeSchema.parse(request.body);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Find the environment in the table
      const env = await db.query.vaultEnvironments.findFirst({
        where: and(eq(vaultEnvironments.vaultId, vault.id), eq(vaultEnvironments.name, envName)),
      });

      if (!env) {
        throw new NotFoundError(`Environment '${envName}' not found`);
      }

      const oldType = env.type;

      // Update the environment type
      await db
        .update(vaultEnvironments)
        .set({
          type: body.type as EnvironmentType,
          updatedAt: new Date(),
        })
        .where(eq(vaultEnvironments.id, env.id));

      // Update vault timestamp
      await db.update(vaults).set({ updatedAt: new Date() }).where(eq(vaults.id, vault.id));

      // Log activity
      const user = await getUserFromVcsUser(vcsUser);
      if (user) {
        await logActivity({
          userId: user.id,
          action: "environment_type_changed",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: { environment: envName, oldType, newType: body.type, repoFullName },
          ...extractRequestInfo(request),
        });
      }

      fastify.log.info(
        { repoFullName, environment: envName, oldType, newType: body.type },
        "Environment type changed"
      );

      return sendData(
        reply,
        {
          environment: envName,
          oldType,
          newType: body.type,
        },
        { requestId: request.id }
      );
    }
  );

  // ============================================
  // Permission routes
  // ============================================

  /**
   * GET /:owner/:repo/permissions
   * Get permission configuration for a vault
   */
  fastify.get(
    "/:owner/:repo/permissions",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      const permissions = await getVaultPermissions(vault.id);

      return sendData(
        reply,
        {
          repoFullName,
          vaultId: vault.id,
          ...permissions,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * PUT /:owner/:repo/permissions/:env
   * Set custom permissions for an environment (admin only)
   */
  fastify.put(
    "/:owner/:repo/permissions/:env",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; env: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const environment = params.env;
      const body = EnvironmentPermissionsSchema.parse(request.body);

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Delete existing custom permissions for this environment
      await db
        .delete(environmentPermissions)
        .where(
          and(
            eq(environmentPermissions.vaultId, vault.id),
            eq(environmentPermissions.environment, environment)
          )
        );

      // Insert new custom permissions
      await db.insert(environmentPermissions).values([
        {
          vaultId: vault.id,
          environment,
          permissionType: "read",
          minRole: body.permissions.read as CollaboratorRole,
        },
        {
          vaultId: vault.id,
          environment,
          permissionType: "write",
          minRole: body.permissions.write as CollaboratorRole,
        },
      ]);

      fastify.log.info(
        { repoFullName, environment, permissions: body.permissions },
        "Custom permissions set"
      );

      return sendData(
        reply,
        {
          success: true,
          message: `Custom permissions set for environment: ${environment}`,
          permissions: body.permissions,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * DELETE /:owner/:repo/permissions/:env
   * Reset environment to default permissions (admin only)
   */
  fastify.delete(
    "/:owner/:repo/permissions/:env",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string; env: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const environment = params.env;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Delete custom permissions for this environment
      await db
        .delete(environmentPermissions)
        .where(
          and(
            eq(environmentPermissions.vaultId, vault.id),
            eq(environmentPermissions.environment, environment)
          )
        );

      fastify.log.info({ repoFullName, environment }, "Custom permissions reset to defaults");

      return sendData(
        reply,
        {
          success: true,
          message: `Permissions reset to defaults for environment: ${environment}`,
          defaults: {
            read: getDefaultPermission(environment, "read"),
            write: getDefaultPermission(environment, "write"),
          },
        },
        { requestId: request.id }
      );
    }
  );

  // ============================================
  // Security routes
  // ============================================

  /**
   * GET /:owner/:repo/security/alerts
   * Get security alerts for a vault
   */
  fastify.get(
    "/:owner/:repo/security/alerts",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const repoFullName = `${params.owner}/${params.repo}`;
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50", 10), 100);
      const offset = parseInt(query.offset || "0", 10);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const role = await getUserRoleWithApp(vault.repoFullName, vcsUser.username);
      if (!role) {
        throw new ForbiddenError("You do not have access to this vault");
      }

      const alerts = await getSecurityAlerts(vault.id, limit, offset);

      return sendData(
        reply,
        alerts.map((a) => ({
          id: a.id,
          type: a.alertType,
          message: a.message,
          createdAt: a.createdAt,
          event: a.pullEvent
            ? {
                ip: a.pullEvent.ip,
                location: { country: a.pullEvent.country, city: a.pullEvent.city },
                deviceId: a.pullEvent.deviceId,
              }
            : null,
        })),
        { requestId: request.id }
      );
    }
  );

  // ============================================
  // Collaborators routes
  // ============================================

  /**
   * GET /:owner/:repo/collaborators
   * Get all collaborators for a repository with their permission levels
   * Includes both GitHub permissions and derived Keyway permissions
   * Uses GitHub App token when available for enhanced access
   * Requires admin access to the repository
   */
  fastify.get(
    "/:owner/:repo/collaborators",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const { owner, repo } = params;
      const repoFullName = `${owner}/${repo}`;

      // Check if vault exists
      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Fetch collaborators from GitHub API using GitHub App installation token
      const collaborators = await getRepoCollaboratorsWithApp(owner, repo);

      // Enrich with Keyway permissions based on GitHub role
      const enrichedCollaborators = collaborators.map((collab) => {
        // Derive Keyway permissions from GitHub role
        // These match the permission model in utils/permissions.ts
        const canRead = ["read", "triage", "write", "maintain", "admin"].includes(
          collab.permission
        );
        const canWrite = ["write", "maintain", "admin"].includes(collab.permission);
        const canManage = collab.permission === "admin";

        return {
          login: collab.login,
          avatarUrl: collab.avatarUrl,
          htmlUrl: collab.htmlUrl,
          githubPermission: collab.permission,
          keywayPermissions: {
            canRead,
            canWrite,
            canManage,
          },
          type: collab.login.endsWith("[bot]") ? "bot" : "user",
        };
      });

      return sendData(
        reply,
        {
          repoFullName,
          provider: "github",
          collaborators: enrichedCollaborators,
        },
        { requestId: request.id }
      );
    }
  );

  // Keep old endpoint for backwards compatibility (deprecated)
  fastify.get(
    "/:owner/:repo/contributors",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets"), requireAdminAccess],
    },
    async (request, reply) => {
      const params = request.params as { owner: string; repo: string };
      const { owner, repo } = params;
      const repoFullName = `${owner}/${repo}`;

      const vault = await getVaultByRepoInternal(repoFullName);
      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      const collaborators = await getRepoCollaboratorsWithApp(owner, repo);

      return sendData(
        reply,
        {
          repoId: repoFullName,
          provider: "github",
          contributors: collaborators,
        },
        { requestId: request.id }
      );
    }
  );
}
