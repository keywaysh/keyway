import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authenticateGitHub,
  requireEnvironmentAccess,
  requireApiKeyScope,
} from "../../../middleware/auth";
import { db, vaults, users, secrets } from "../../../db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { getEncryptionService } from "../../../utils/encryption";
import { toEnvFormat } from "../../../utils/legacyEnvFormat";
import { hasRequiredScopes } from "../../../utils/apiKeys";
import { resolveEffectivePermission, hasEnvironmentPermission } from "../../../utils/permissions";
import {
  sendData,
  NotFoundError,
  BadRequestError,
  ConflictError,
  PlanLimitError,
} from "../../../lib";
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
import { saveSecretVersions } from "../../../services/secretVersion.service";
import {
  planPush,
  resolvePushMode,
  describeRejections,
  describeKept,
  type PushPlan,
} from "../../../services/pushPlan.service";
import { config } from "../../../config";
import { repoFullNameSchema } from "../../../types";
import type { RecordAccessContext, SecretAccessRecord } from "../../../services";

// Security limits for secrets
const MAX_SECRET_KEY_LENGTH = 256;
const MAX_SECRET_VALUE_SIZE = 64 * 1024; // 64KB
const MAX_SECRETS_PER_PUSH = 1000; // Maximum secrets per push operation
const MAX_PUSH_ATTEMPTS = 3; // Plans re-made when the environment changes mid-push

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
  // merge keeps secrets missing from the push; replace trashes them. Released clients send none.
  mode: z.enum(["merge", "replace"]).optional(),
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

type EncryptionService = Awaited<ReturnType<typeof getEncryptionService>>;
type SecretRow = typeof secrets.$inferSelect;

// Crypto service calls run a few at a time: an environment can hold up to 1000 secrets.
async function inBatches<T, R>(items: T[], call: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += 25) {
    results.push(...(await Promise.all(items.slice(i, i + 25).map(call))));
  }
  return results;
}

// Stored values by key. A value the crypto service cannot decrypt (e.g. its key version was
// retired) becomes a placeholder no client sends, so the push can still overwrite it.
async function decryptValues(
  encryptionService: EncryptionService,
  rows: SecretRow[]
): Promise<{ values: Record<string, string>; undecryptable: number }> {
  const values: Record<string, string> = Object.create(null);
  const decrypted = await inBatches(rows, (row) =>
    encryptionService
      .decrypt({
        encryptedContent: row.encryptedValue,
        iv: row.iv,
        authTag: row.authTag,
        version: row.encryptionVersion,
      })
      .catch(() => null)
  );
  let undecryptable = 0;
  rows.forEach((row, i) => {
    const value = decrypted[i];
    if (value === null) {
      undecryptable++;
    }
    values[row.key] = value ?? `\0undecryptable:${row.id}`;
  });
  return { values, undecryptable };
}

// True when `rows` are the rows of `snapshot`, with the same ciphertext.
function sameRows(rows: SecretRow[], snapshot: SecretRow[]): boolean {
  const byId = new Map(snapshot.map((row) => [row.id, row]));
  return (
    rows.length === snapshot.length &&
    rows.every((row) => {
      const before = byId.get(row.id);
      return (
        before !== undefined &&
        before.key === row.key &&
        before.encryptedValue === row.encryptedValue &&
        before.iv === row.iv &&
        before.authTag === row.authTag &&
        before.encryptionVersion === row.encryptionVersion
      );
    })
  );
}

// API keys need the read scope, and every caller needs read permission on the environment.
async function canReadEnvironment(
  request: FastifyRequest,
  vaultId: string,
  environment: string,
  userId: string | undefined
): Promise<boolean> {
  if (request.apiKey && !hasRequiredScopes(request.apiKey.scopes, ["read:secrets"])) {
    return false;
  }
  const role = request.repoRole;
  if (!role) {
    return false;
  }
  return userId
    ? resolveEffectivePermission(vaultId, environment, userId, role, "read")
    : hasEnvironmentPermission(vaultId, environment, role, "read");
}

// Postgres lock_not_available, raised by lock_timeout (drizzle wraps it in `cause`).
function isLockTimeout(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | undefined)?.code;
  const causeCode = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === "55P03" || causeCode === "55P03";
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
      // Write only where requireEnvironmentAccess checked (body defaults included)
      const checked = request.checkedEnvironment;
      if (
        checked?.repoFullName !== body.repoFullName ||
        checked.environment !== body.environment
      ) {
        throw new BadRequestError(
          "The repository and environment must be the same in the URL and in the request body"
        );
      }
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

      fastify.log.info(
        {
          repoFullName: body.repoFullName,
          environment: body.environment,
          secretCount: Object.keys(body.secrets).length,
        },
        "Pushing secrets via v1 API"
      );

      const platform = detectPlatform(request);
      const userAgent = request.headers["user-agent"];
      const encryptionService = await getEncryptionService();
      const canRead = await canReadEnvironment(request, vault.id, body.environment, user?.id);
      // Active secrets of this environment (trash excluded)
      const activeSecrets = and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, body.environment),
        isNull(secrets.deletedAt)
      );

      // Crypto calls happen before the transaction, which only re-checks and writes, so its
      // locks last a few queries. If another write landed in between, plan again.
      let plan: PushPlan | undefined;
      for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS && !plan; attempt++) {
        const snapshot = await db.select().from(secrets).where(activeSecrets);
        const { values: current, undecryptable } = await decryptValues(encryptionService, snapshot);
        if (undecryptable > 0) {
          request.log.warn({ undecryptable, platform }, "Push: stored values cannot be decrypted");
        }
        const candidate = planPush(current, body.secrets, { mode: body.mode, userAgent, canRead });

        // Refuse before any write
        if (candidate.rejected.length > 0) {
          request.log.warn(
            { rejected: candidate.rejected.length, platform },
            "Push refused: values a released client mis-parsed"
          );
          throw new BadRequestError(
            describeRejections(candidate.rejected, config.app.dashboardUrl)
          );
        }

        const toWrite = [...candidate.update, ...candidate.create];
        const encryptedValues = await inBatches(toWrite, (key) =>
          encryptionService.encrypt(body.secrets[key])
        );
        const encrypted = new Map(toWrite.map((key, i) => [key, encryptedValues[i]]));

        const committed = await db
          .transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
            // Pushes to a vault run one at a time. NO KEY UPDATE does not block the foreign
            // key checks of other requests (e.g. the activity log written by a pull).
            const locked = await tx
              .select({ id: vaults.id })
              .from(vaults)
              .where(eq(vaults.id, vault.id))
              .for("no key update");
            if (locked.length === 0) {
              throw new NotFoundError("Vault not found. Run keyway init first.");
            }
            const rows = await tx.select().from(secrets).where(activeSecrets).for("no key update");
            if (!sameRows(rows, snapshot)) {
              return false;
            }
            const byKey = new Map(rows.map((row) => [row.key, row]));

            // Keep every overwritten value restorable
            await saveSecretVersions(
              candidate.update.map((key) => {
                const row = byKey.get(key)!;
                return {
                  secretId: row.id,
                  vaultId: vault.id,
                  encryptedValue: row.encryptedValue,
                  iv: row.iv,
                  authTag: row.authTag,
                  encryptionVersion: row.encryptionVersion,
                };
              }),
              user?.id,
              tx
            );

            const now = new Date();
            for (const key of candidate.update) {
              const data = encrypted.get(key)!;
              await tx
                .update(secrets)
                .set({
                  encryptedValue: data.encryptedContent,
                  iv: data.iv,
                  authTag: data.authTag,
                  encryptionVersion: data.version ?? 1,
                  lastModifiedById: user?.id ?? null,
                  updatedAt: now,
                })
                .where(eq(secrets.id, byKey.get(key)!.id));
            }

            if (candidate.create.length > 0) {
              await tx.insert(secrets).values(
                candidate.create.map((key) => {
                  const data = encrypted.get(key)!;
                  return {
                    vaultId: vault.id,
                    environment: body.environment,
                    key,
                    encryptedValue: data.encryptedContent,
                    iv: data.iv,
                    authTag: data.authTag,
                    encryptionVersion: data.version ?? 1,
                    lastModifiedById: user?.id ?? null,
                  };
                })
              );
            }

            // Soft-delete secrets the plan removes (move to trash)
            await trashSecretsByIds(
              candidate.trash.map((key) => byKey.get(key)!.id),
              tx
            );

            // Update vault timestamp
            await tx.update(vaults).set({ updatedAt: now }).where(eq(vaults.id, vault.id));
            return true;
          })
          .catch((error: unknown) => {
            if (isLockTimeout(error)) {
              throw new ConflictError("Another push to this vault is still running. Try again.");
            }
            throw error;
          });

        if (committed) {
          plan = candidate;
        }
      }

      if (!plan) {
        throw new ConflictError("The environment changed while pushing. Try again.");
      }

      if (plan.protected.length > 0 || plan.ignored.length > 0) {
        request.log.warn(
          { protected: plan.protected.length, ignored: plan.ignored.length, platform },
          "Push kept stored values a released client sent back corrupted"
        );
      }

      const stats = {
        created: plan.create.length,
        updated: plan.update.length,
        deleted: plan.trash.length,
        unchanged: plan.unchanged.length,
        protected: plan.protected.length,
        ignored: plan.ignored.length,
      };

      // Note: 'user' was already fetched above for plan limit check
      trackEvent(user?.id || "anonymous", AnalyticsEvents.SECRETS_PUSHED, {
        repoFullName: body.repoFullName,
        environment: body.environment,
        ...stats,
        platform,
      });

      if (user) {
        await logActivity({
          userId: user.id,
          action: "secrets_pushed",
          platform,
          vaultId: vault.id,
          metadata: {
            repoFullName: body.repoFullName,
            environment: body.environment,
            ...stats,
          },
          ...extractRequestInfo(request),
        });
      }

      return sendData(
        reply,
        {
          success: true,
          message:
            describeKept(plan.protected, plan.ignored, config.app.dashboardUrl) ??
            "Secrets pushed successfully",
          // Lets a client confirm the server applied the mode it asked for
          mode: resolvePushMode(body.mode, userAgent),
          stats,
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
        throw new NotFoundError(
          `Secret "${key}" not found in environment "${environment}"`
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
