import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticateGitHub,
  requireEnvironmentAccess,
  requireApiKeyScope,
} from "../../../middleware/auth";
import { db, vaults, users, secrets } from "../../../db";
import { eq, and, isNull } from "drizzle-orm";
import { getEncryptionService } from "../../../utils/encryption";
import { sendData, NotFoundError, BadRequestError, PlanLimitError } from "../../../lib";
import { trackEvent, AnalyticsEvents } from "../../../utils/analytics";
import {
  logActivity,
  extractRequestInfo,
  detectPlatform,
  trashSecretsByIds,
  recordSecretAccesses,
  recordSecretAccess,
  getVaultEnvironmentNames,
} from "../../../services";
import {
  processPullEvent,
  generateDeviceId,
  type PullSource,
} from "../../../services/security.service";
import { canWriteToVault } from "../../../services/usage.service";
import { repoFullNameSchema } from "../../../types";
import type { RecordAccessContext, SecretAccessRecord } from "../../../services";

// Security limits for secrets
const MAX_SECRET_KEY_LENGTH = 256;
const MAX_SECRET_VALUE_SIZE = 64 * 1024; // 64KB
const MAX_SECRETS_PER_PUSH = 1000; // Maximum secrets per push operation

// Schemas
const PushSecretsSchema = z.object({
  repoFullName: repoFullNameSchema,
  environment: z.string().min(1).max(50).default("default"),
  secrets: z
    .record(
      z.string().max(MAX_SECRET_KEY_LENGTH, {
        message: `Secret key must not exceed ${MAX_SECRET_KEY_LENGTH} characters`,
      }),
      z.string().max(MAX_SECRET_VALUE_SIZE, {
        message: `Secret value must not exceed ${MAX_SECRET_VALUE_SIZE} bytes (64KB)`,
      })
    )
    .refine((secrets) => Object.keys(secrets).length <= MAX_SECRETS_PER_PUSH, {
      message: `Cannot push more than ${MAX_SECRETS_PER_PUSH} secrets at once`,
    }),
});

const PullSecretsQuerySchema = z.object({
  repo: z.string(),
  environment: z.string().default("default"),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ViewSecretQuerySchema = z.object({
  repo: z.string(),
  environment: z.string().default("default"),
  key: z.string().min(1).max(MAX_SECRET_KEY_LENGTH),
});

/**
 * Parse .env content into key-value pairs
 */
function _parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1);

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert secrets to .env format
 */
function toEnvFormat(secretsMap: Record<string, string>): string {
  return Object.entries(secretsMap)
    .map(([key, value]) => {
      if (value.includes(" ") || value.includes("\n") || value.includes('"')) {
        return `${key}="${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    })
    .join("\n");
}

/**
 * Secrets routes (CLI/MCP-focused)
 * POST /api/v1/secrets/push - Push secrets from CLI
 * GET  /api/v1/secrets/pull - Pull secrets to CLI
 * GET  /api/v1/secrets/view - View a single secret (MCP)
 */
export async function secretsRoutes(fastify: FastifyInstance) {
  /**
   * POST /push
   * Push secrets (CLI format - JSON object of key-value pairs)
   */
  fastify.post(
    "/push",
    {
      preHandler: [
        authenticateGitHub,
        requireApiKeyScope("write:secrets"),
        requireEnvironmentAccess("write"),
      ],
    },
    async (request, reply) => {
      const body = PushSecretsSchema.parse(request.body);
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, body.repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found. Run keyway init first.");
      }

      // Check plan limit for write access (soft limit for downgraded users)
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (user) {
        const writeCheck = await canWriteToVault(user.id, user.plan, vault.id, vault.isPrivate);
        if (!writeCheck.allowed) {
          throw new PlanLimitError(writeCheck.reason!);
        }
      }

      // Validate environment exists in vault's environment list
      const vaultEnvs = await getVaultEnvironmentNames(vault.id);

      if (!vaultEnvs.includes(body.environment)) {
        throw new BadRequestError(
          `Environment '${body.environment}' does not exist in this vault. ` +
            `Available environments: ${vaultEnvs.join(", ")}. ` +
            `Create it first via the dashboard or API.`
        );
      }

      const secretEntries = Object.entries(body.secrets);

      fastify.log.info(
        {
          repoFullName: body.repoFullName,
          environment: body.environment,
          secretCount: secretEntries.length,
        },
        "Pushing secrets via v1 API"
      );

      // Get existing secrets for this environment (active only, excludes trash)
      const existingSecrets = await db.query.secrets.findMany({
        where: and(
          eq(secrets.vaultId, vault.id),
          eq(secrets.environment, body.environment),
          isNull(secrets.deletedAt)
        ),
      });

      const existingByKey = new Map(existingSecrets.map((s) => [s.key, s]));

      let created = 0;
      let updated = 0;

      const encryptionService = await getEncryptionService();
      for (const [key, value] of secretEntries) {
        const encryptedData = await encryptionService.encrypt(value);
        const existing = existingByKey.get(key);

        if (existing) {
          await db
            .update(secrets)
            .set({
              encryptedValue: encryptedData.encryptedContent,
              iv: encryptedData.iv,
              authTag: encryptedData.authTag,
              encryptionVersion: encryptedData.version ?? 1,
              updatedAt: new Date(),
            })
            .where(eq(secrets.id, existing.id));
          updated++;
        } else {
          await db.insert(secrets).values({
            vaultId: vault.id,
            environment: body.environment,
            key,
            encryptedValue: encryptedData.encryptedContent,
            iv: encryptedData.iv,
            authTag: encryptedData.authTag,
            encryptionVersion: encryptedData.version ?? 1,
          });
          created++;
        }
      }

      // Soft-delete secrets not in the pushed set (move to trash)
      const idsToTrash = existingSecrets
        .filter((s) => !Object.hasOwn(body.secrets, s.key))
        .map((s) => s.id);

      if (idsToTrash.length > 0) {
        await trashSecretsByIds(idsToTrash);
      }

      // Update vault timestamp
      await db.update(vaults).set({ updatedAt: new Date() }).where(eq(vaults.id, vault.id));

      // Note: 'user' was already fetched above for plan limit check
      trackEvent(user?.id || "anonymous", AnalyticsEvents.SECRETS_PUSHED, {
        repoFullName: body.repoFullName,
        environment: body.environment,
        created,
        updated,
        deleted: idsToTrash.length,
        platform: detectPlatform(request),
      });

      if (user) {
        await logActivity({
          userId: user.id,
          action: "secrets_pushed",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: {
            repoFullName: body.repoFullName,
            environment: body.environment,
            created,
            updated,
            deleted: idsToTrash.length,
          },
          ...extractRequestInfo(request),
        });
      }

      return sendData(
        reply,
        {
          success: true,
          message: "Secrets pushed successfully",
          stats: { created, updated, deleted: idsToTrash.length },
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /pull
   * Pull secrets (returns .env format content)
   */
  fastify.get(
    "/pull",
    {
      preHandler: [
        authenticateGitHub,
        requireApiKeyScope("read:secrets"),
        requireEnvironmentAccess("read"),
      ],
    },
    async (request, reply) => {
      const query = PullSecretsQuerySchema.parse(request.query);
      const repoFullName = query.repo;
      const environment = query.environment;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Fetch secrets with optional pagination (active only, excludes trash)
      const queryOptions: any = {
        where: and(
          eq(secrets.vaultId, vault.id),
          eq(secrets.environment, environment),
          isNull(secrets.deletedAt)
        ),
      };

      if (query.limit !== undefined) {
        queryOptions.limit = query.limit;
        if (query.offset !== undefined) {
          queryOptions.offset = query.offset;
        }
      }

      const envSecrets = await db.query.secrets.findMany(queryOptions);

      if (envSecrets.length === 0) {
        throw new NotFoundError(`No secrets found for environment: ${environment}`);
      }

      // Log warning for large unpaginated pulls
      if (!query.limit && envSecrets.length > 100) {
        fastify.log.warn(
          {
            repoFullName,
            environment,
            secretCount: envSecrets.length,
          },
          "Large unpaginated secret pull detected"
        );
      }

      // Decrypt and build content
      const encryptionService = await getEncryptionService();
      const secretsMap: Record<string, string> = {};
      for (const secret of envSecrets) {
        secretsMap[secret.key] = await encryptionService.decrypt({
          encryptedContent: secret.encryptedValue,
          iv: secret.iv,
          authTag: secret.authTag,
          version: secret.encryptionVersion ?? 1,
        });
      }

      const content = toEnvFormat(secretsMap);

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      trackEvent(user?.id || "anonymous", AnalyticsEvents.SECRETS_PULLED, {
        repoFullName,
        environment,
        secretCount: envSecrets.length,
        platform: detectPlatform(request),
      });

      if (user) {
        await logActivity({
          userId: user.id,
          action: "secrets_pulled",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: {
            repoFullName,
            environment,
            secretCount: envSecrets.length,
            // Include secret keys in metadata for enriched audit trail
            secretKeys: envSecrets.map((s) => s.key),
          },
          ...extractRequestInfo(request),
        });

        // Fire-and-forget security detection - don't block response
        const deviceId = generateDeviceId(
          request.headers["user-agent"] || null,
          request.ip || "unknown"
        );
        // Determine pull source for audit trail and alert filtering
        const platform = detectPlatform(request);
        const pullSource: PullSource = request.apiKey
          ? "api_key"
          : platform === "mcp"
            ? "mcp"
            : "cli";
        processPullEvent({
          userId: user.id,
          vaultId: vault.id,
          deviceId,
          ip: request.ip || "unknown",
          userAgent: request.headers["user-agent"] || null,
          source: pullSource,
        }).catch((err) => fastify.log.error(err, "Security detection failed"));

        // Fire-and-forget exposure tracking - record which secrets this user accessed
        const accessCtx: RecordAccessContext = {
          userId: user.id,
          username: vcsUser.username,
          userAvatarUrl: vcsUser.avatarUrl,
          vaultId: vault.id,
          repoFullName,
          environment,
          githubRole: request.repoRole || "read",
          platform: detectPlatform(request),
          ipAddress: request.ip,
          deviceId,
        };
        const secretRecords: SecretAccessRecord[] = envSecrets.map((s) => ({
          secretId: s.id,
          secretKey: s.key,
        }));
        recordSecretAccesses(accessCtx, secretRecords).catch((err) =>
          fastify.log.error(err, "Exposure tracking failed")
        );
      }

      return sendData(reply, { content }, { requestId: request.id });
    }
  );

  /**
   * GET /view
   * View a single secret value (for MCP and other clients)
   */
  fastify.get(
    "/view",
    {
      preHandler: [
        authenticateGitHub,
        requireApiKeyScope("read:secrets"),
        requireEnvironmentAccess("read"),
      ],
    },
    async (request, reply) => {
      const query = ViewSecretQuerySchema.parse(request.query);
      const { repo: repoFullName, environment, key } = query;
      const vcsUser = request.vcsUser || request.githubUser!;

      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // Get all secrets for this environment to find the requested one
      // and provide helpful error message if not found
      const envSecrets = await db.query.secrets.findMany({
        where: and(
          eq(secrets.vaultId, vault.id),
          eq(secrets.environment, environment),
          isNull(secrets.deletedAt)
        ),
      });

      const secret = envSecrets.find((s) => s.key === key);

      if (!secret) {
        const availableKeys = envSecrets.map((s) => s.key).sort();
        const availableList =
          availableKeys.length > 0
            ? `Available secrets: ${availableKeys.join(", ")}`
            : "No secrets found in this environment";
        throw new NotFoundError(
          `Secret "${key}" not found in environment "${environment}". ${availableList}`
        );
      }

      const encryptionService = await getEncryptionService();
      const value = await encryptionService.decrypt({
        encryptedContent: secret.encryptedValue,
        iv: secret.iv,
        authTag: secret.authTag,
        version: secret.encryptionVersion ?? 1,
      });

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      trackEvent(user?.id || "anonymous", AnalyticsEvents.SECRET_VIEWED, {
        repoFullName,
        environment,
        platform: detectPlatform(request),
      });

      if (user) {
        await logActivity({
          userId: user.id,
          action: "secret_value_accessed",
          platform: detectPlatform(request),
          vaultId: vault.id,
          metadata: {
            repoFullName,
            environment,
            secretName: key,
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
          repoFullName,
          environment,
          githubRole: request.repoRole || "read",
          platform: detectPlatform(request),
          ipAddress: request.ip,
          deviceId,
        };
        fastify.log.info(
          { userId: user.id, secretId: secret.id, secretKey: secret.key },
          "Recording secret access for exposure"
        );
        recordSecretAccess(accessCtx, {
          secretId: secret.id,
          secretKey: secret.key,
        })
          .then(() => {
            fastify.log.info({ secretId: secret.id }, "Exposure tracking succeeded");
          })
          .catch((err) => {
            fastify.log.error({ err, secretId: secret.id }, "Exposure tracking failed");
          });
      }

      return sendData(reply, { key, value, environment }, { requestId: request.id });
    }
  );
}
