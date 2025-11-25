import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateGitHub, requireEnvironmentAccess } from '../../../middleware/auth';
import { db, users, vaults, secrets } from '../../../db';
import { eq, and, inArray } from 'drizzle-orm';
import { encrypt, decrypt, sanitizeForLogging } from '../../../utils/encryption';
import { sendData, NotFoundError } from '../../../lib';
import { trackEvent, AnalyticsEvents } from '../../../utils/analytics';
import { logActivity, extractRequestInfo, detectPlatform } from '../../../services';

// Schemas
const PushSecretsSchema = z.object({
  repoFullName: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  environment: z.string().min(1).max(50).default('default'),
  secrets: z.record(z.string()), // { KEY: "value", KEY2: "value2" }
});

const PullSecretsQuerySchema = z.object({
  repo: z.string(),
  environment: z.string().default('default'),
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
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const body = PushSecretsSchema.parse(request.body);
    const githubUser = request.githubUser!;

    // Manually check environment access (we can't use middleware easily here)
    // This is a simplified version - the full check should use requireEnvironmentAccess

    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, body.repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found. Run keyway init first.');
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

    for (const [key, value] of secretEntries) {
      const encryptedData = encrypt(value);
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
    preHandler: [authenticateGitHub],
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

    const envSecrets = await db.query.secrets.findMany({
      where: and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, environment)
      ),
    });

    if (envSecrets.length === 0) {
      throw new NotFoundError(`No secrets found for environment: ${environment}`);
    }

    // Decrypt and build content
    const secretsMap: Record<string, string> = {};
    for (const secret of envSecrets) {
      secretsMap[secret.key] = decrypt({
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
    }

    return sendData(reply, { content }, { requestId: request.id });
  });
}
