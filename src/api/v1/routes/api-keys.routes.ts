import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateGitHub } from '../../../middleware/auth';
import { db, users, apiKeys } from '../../../db';
import { eq, and, isNull } from 'drizzle-orm';
import { sendData, NotFoundError, BadRequestError, ForbiddenError } from '../../../lib';
import {
  generateApiKey,
  hashApiKey,
  validateScopes,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from '../../../utils/apiKeys';
import { logActivity, extractRequestInfo, detectPlatform } from '../../../services';

// Schemas
const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  environment: z.enum(['live', 'test']),
  scopes: z.array(z.string()).min(1),
  expiresInDays: z.number().int().positive().max(365).optional(),
  allowedIps: z.array(z.string()).optional(),
});

const ApiKeyIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * API Keys routes
 * POST   /api/v1/api-keys     - Create a new API key
 * GET    /api/v1/api-keys     - List all API keys for the user
 * GET    /api/v1/api-keys/:id - Get a specific API key
 * DELETE /api/v1/api-keys/:id - Revoke an API key
 */
export async function apiKeysRoutes(fastify: FastifyInstance) {
  /**
   * POST /
   * Create a new API key
   */
  fastify.post('/', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const body = CreateApiKeySchema.parse(request.body);
    const githubUser = request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found. Please login first.');
    }

    // Validate scopes
    if (!validateScopes(body.scopes)) {
      throw new BadRequestError(
        `Invalid scopes. Valid scopes are: ${API_KEY_SCOPES.join(', ')}`
      );
    }

    // Generate the API key
    const generated = generateApiKey(body.environment);

    // Calculate expiration date if specified
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Insert into database
    const [apiKey] = await db.insert(apiKeys).values({
      userId: user.id,
      name: body.name,
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      environment: body.environment,
      scopes: body.scopes,
      expiresAt,
      allowedIps: body.allowedIps || null,
      createdFromIp: request.ip || null,
      createdUserAgent: request.headers['user-agent'] || null,
    }).returning();

    // Log activity
    await logActivity({
      userId: user.id,
      action: 'api_key_created',
      platform: detectPlatform(request),
      metadata: {
        apiKeyId: apiKey.id,
        apiKeyName: body.name,
        environment: body.environment,
        scopes: body.scopes,
      },
      ...extractRequestInfo(request),
    });

    fastify.log.info({
      userId: user.id,
      apiKeyId: apiKey.id,
      environment: body.environment,
    }, 'API key created');

    // Return the full token ONLY on creation
    return sendData(reply, {
      id: apiKey.id,
      name: apiKey.name,
      token: generated.token, // This is the ONLY time the full token is returned!
      prefix: apiKey.keyPrefix,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString() || null,
      lastUsedAt: null, // New key, never used
      usageCount: 0, // New key, zero usage
      createdAt: apiKey.createdAt.toISOString(),
      revokedAt: null, // New key, not revoked
      revokedReason: null,
      isActive: true, // New key is always active
    }, { requestId: request.id });
  });

  /**
   * GET /
   * List all API keys for the authenticated user
   */
  fastify.get('/', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const githubUser = request.githubUser!;

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Get all API keys (including revoked for audit purposes)
    const keys = await db.query.apiKeys.findMany({
      where: eq(apiKeys.userId, user.id),
      orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
    });

    const keyList = keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.keyPrefix, // Never return the full token!
      environment: key.environment,
      scopes: key.scopes,
      expiresAt: key.expiresAt?.toISOString() || null,
      lastUsedAt: key.lastUsedAt?.toISOString() || null,
      usageCount: key.usageCount,
      createdAt: key.createdAt.toISOString(),
      revokedAt: key.revokedAt?.toISOString() || null,
      revokedReason: key.revokedReason,
      isActive: !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date()),
    }));

    return sendData(reply, { keys: keyList }, { requestId: request.id });
  });

  /**
   * GET /:id
   * Get a specific API key
   */
  fastify.get('/:id', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const params = ApiKeyIdParamsSchema.parse(request.params);
    const githubUser = request.githubUser!;

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const apiKey = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.id, params.id),
        eq(apiKeys.userId, user.id)
      ),
    });

    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    return sendData(reply, {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.keyPrefix,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString() || null,
      lastUsedAt: apiKey.lastUsedAt?.toISOString() || null,
      usageCount: apiKey.usageCount,
      allowedIps: apiKey.allowedIps,
      createdAt: apiKey.createdAt.toISOString(),
      revokedAt: apiKey.revokedAt?.toISOString() || null,
      revokedReason: apiKey.revokedReason,
      isActive: !apiKey.revokedAt && (!apiKey.expiresAt || apiKey.expiresAt > new Date()),
    }, { requestId: request.id });
  });

  /**
   * DELETE /:id
   * Revoke an API key
   */
  fastify.delete('/:id', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const params = ApiKeyIdParamsSchema.parse(request.params);
    const githubUser = request.githubUser!;

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const apiKey = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.id, params.id),
        eq(apiKeys.userId, user.id)
      ),
    });

    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    if (apiKey.revokedAt) {
      throw new BadRequestError('API key is already revoked');
    }

    // Revoke the key
    await db.update(apiKeys)
      .set({
        revokedAt: new Date(),
        revokedReason: 'manual',
      })
      .where(eq(apiKeys.id, params.id));

    // Log activity
    await logActivity({
      userId: user.id,
      action: 'api_key_revoked',
      platform: detectPlatform(request),
      metadata: {
        apiKeyId: apiKey.id,
        apiKeyName: apiKey.name,
        reason: 'manual',
      },
      ...extractRequestInfo(request),
    });

    fastify.log.info({
      userId: user.id,
      apiKeyId: apiKey.id,
    }, 'API key revoked');

    reply.status(204).send();
  });
}
