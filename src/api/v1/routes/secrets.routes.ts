import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateGitHub, requireEnvironmentAccess } from '../../../middleware/auth';
import { db, users, vaults, secrets } from '../../../db';
import { eq, and, inArray } from 'drizzle-orm';
import { getEncryptionService, sanitizeForLogging } from '../../../utils/encryption';
import { sendData, NotFoundError, BadRequestError } from '../../../lib';
import { trackEvent, AnalyticsEvents } from '../../../utils/analytics';
import { logActivity, extractRequestInfo, detectPlatform } from '../../../services';
import { processPullEvent, generateDeviceId } from '../../../services/security.service';
import { repoFullNameSchema, DEFAULT_ENVIRONMENTS } from '../../../types';

// Security limits for secrets
const MAX_SECRET_KEY_LENGTH = 256;
const MAX_SECRET_VALUE_SIZE = 64 * 1024; // 64KB
const MAX_SECRETS_PER_PUSH = 1000; // Maximum secrets per push operation

// Schemas
const PushSecretsSchema = z.object({
  repoFullName: repoFullNameSchema,
  environment: z.string().min(1).max(50).default('default'),
  secrets: z.record(
    z.string().max(MAX_SECRET_KEY_LENGTH, {
      message: `Secret key must not exceed ${MAX_SECRET_KEY_LENGTH} characters`,
    }),
    z.string().max(MAX_SECRET_VALUE_SIZE, {
      message: `Secret value must not exceed ${MAX_SECRET_VALUE_SIZE} bytes (64KB)`,
    })
  ).refine(
    (secrets) => Object.keys(secrets).length <= MAX_SECRETS_PER_PUSH,
    {
      message: `Cannot push more than ${MAX_SECRETS_PER_PUSH} secrets at once`,
    }
  ),
});

const PullSecretsQuerySchema = z.object({
  repo: z.string(),
  environment: z.string().default('default'),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Parse .env content into key-value pairs
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1);

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }

  return result;
}

/**
 * Convert secrets to .env format
 */
function toEnvFormat(secretsMap: Record<string, string>): string {
  return Object.entries(secretsMap)
    .map(([key, value]) => {
      if (value.includes(' ') || value.includes('\n') || value.includes('"')) {
        return `${key}="${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    })
    .join('\n');
}

/**
 * Secrets routes (CLI-focused)
 * POST /api/v1/secrets/push - Push secrets from CLI
 * GET  /api/v1/secrets/pull - Pull secrets to CLI
 */
export async function secretsRoutes(fastify: FastifyInstance) {
  /**
   * POST /push
   * Push secrets (CLI format - JSON object of key-value pairs)
   */
  fastify.post('/push', {
    preHandler: [authenticateGitHub, requireEnvironmentAccess('write')],
  }, async (request, reply) => {
    const body = PushSecretsSchema.parse(request.body);
    const githubUser = request.githubUser!;

    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, body.repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found. Run keyway init first.');
    }

    // Validate environment exists in vault's environment list
    const vaultEnvs = vault.environments && vault.environments.length > 0
      ? vault.environments
      : [...DEFAULT_ENVIRONMENTS];

    if (!vaultEnvs.includes(body.environment)) {
      throw new BadRequestError(
        `Environment '${body.environment}' does not exist in this vault. ` +
        `Available environments: ${vaultEnvs.join(', ')}. ` +
        `Create it first via the dashboard or API.`
      );
    }

    const secretEntries = Object.entries(body.secrets);

    fastify.log.info({
      repoFullName: body.repoFullName,
      environment: body.environment,
      secretCount: secretEntries.length,
    }, 'Pushing secrets via v1 API');

    // Get existing secrets for this environment
    const existingSecrets = await db.query.secrets.findMany({
      where: and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, body.environment)
      ),
    });

    const existingByKey = new Map(existingSecrets.map(s => [s.key, s]));

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
        });
        created++;
      }
    }

    // Delete secrets not in the pushed set
    const keysToDelete = existingSecrets
      .filter(s => !body.secrets.hasOwnProperty(s.key))
      .map(s => s.id);

    if (keysToDelete.length > 0) {
      await db.delete(secrets).where(inArray(secrets.id, keysToDelete));
    }

    // Update vault timestamp
    await db
      .update(vaults)
      .set({ updatedAt: new Date() })
      .where(eq(vaults.id, vault.id));

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    trackEvent(user?.id || 'anonymous', AnalyticsEvents.SECRETS_PUSHED, {
      repoFullName: body.repoFullName,
      environment: body.environment,
      created,
      updated,
      deleted: keysToDelete.length,
    });

    if (user) {
      await logActivity({
        userId: user.id,
        action: 'secrets_pushed',
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          repoFullName: body.repoFullName,
          environment: body.environment,
          created,
          updated,
          deleted: keysToDelete.length,
        },
        ...extractRequestInfo(request),
      });
    }

    return sendData(reply, {
      success: true,
      message: 'Secrets pushed successfully',
      stats: { created, updated, deleted: keysToDelete.length },
    }, { requestId: request.id });
  });

  /**
   * GET /pull
   * Pull secrets (returns .env format content)
   */
  fastify.get('/pull', {
    preHandler: [authenticateGitHub, requireEnvironmentAccess('read')],
  }, async (request, reply) => {
    const query = PullSecretsQuerySchema.parse(request.query);
    const repoFullName = query.repo;
    const environment = query.environment;
    const githubUser = request.githubUser!;

    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Fetch secrets with optional pagination
    const queryOptions: any = {
      where: and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, environment)
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
      fastify.log.warn({
        repoFullName,
        environment,
        secretCount: envSecrets.length,
      }, 'Large unpaginated secret pull detected');
    }

    // Decrypt and build content
    const encryptionService = await getEncryptionService();
    const secretsMap: Record<string, string> = {};
    for (const secret of envSecrets) {
      secretsMap[secret.key] = await encryptionService.decrypt({
        encryptedContent: secret.encryptedValue,
        iv: secret.iv,
        authTag: secret.authTag,
      });
    }

    const content = toEnvFormat(secretsMap);

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    trackEvent(user?.id || 'anonymous', AnalyticsEvents.SECRETS_PULLED, {
      repoFullName,
      environment,
      secretCount: envSecrets.length,
    });

    if (user) {
      await logActivity({
        userId: user.id,
        action: 'secrets_pulled',
        platform: detectPlatform(request),
        vaultId: vault.id,
        metadata: {
          repoFullName,
          environment,
          secretCount: envSecrets.length,
        },
        ...extractRequestInfo(request),
      });

      // Fire-and-forget security detection - don't block response
      const deviceId = generateDeviceId(
        request.headers['user-agent'] || null,
        request.ip || 'unknown'
      );
      processPullEvent({
        userId: user.id,
        vaultId: vault.id,
        deviceId,
        ip: request.ip || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      }).catch(err => fastify.log.error(err, 'Security detection failed'));
    }

    return sendData(reply, { content }, { requestId: request.id });
  });
}
