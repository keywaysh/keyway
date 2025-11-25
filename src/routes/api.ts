import { FastifyInstance } from 'fastify';
import { db, users, vaults, secrets, activityLogs } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import { authenticateGitHub } from '../middleware/auth';
import { NotFoundError, ForbiddenError } from '../errors';
import { encrypt, sanitizeForLogging } from '../utils/encryption';
import { hasRepoAccess } from '../utils/github';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import {
  UpsertSecretRequestSchema,
  VaultIdParamSchema,
  VaultSecretIdParamSchema,
  type UserProfileResponse,
  type VaultListItem,
  type VaultListResponse,
  type VaultMetadataResponse,
  type SecretListItem,
  type SecretListResponse,
  type UpsertSecretResponse,
  type ActivityLogItem,
  type ActivityLogResponse,
} from '../types';
import type { ActivityAction, ActivityPlatform } from '../db/schema';

// Helper to get GitHub avatar URL for a repo owner
function getGitHubAvatarUrl(owner: string): string {
  return `https://github.com/${owner}.png`;
}

// Helper to log activity
async function logActivity(
  userId: string,
  action: ActivityAction,
  platform: ActivityPlatform,
  vaultId?: string | null,
  metadata?: Record<string, unknown>,
  request?: { ip?: string; headers?: { 'user-agent'?: string } }
) {
  await db.insert(activityLogs).values({
    userId,
    vaultId: vaultId || null,
    action,
    platform,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ipAddress: request?.ip || null,
    userAgent: request?.headers?.['user-agent'] || null,
  });
}

export async function apiRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/me
   * Return the authenticated user profile
   */
  fastify.get('/me', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const githubUser = request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      // User hasn't initialized any vault yet but has valid token
      // Return profile from GitHub data
      const response: UserProfileResponse = {
        id: null,
        githubId: githubUser.githubId,
        username: githubUser.username,
        email: githubUser.email,
        avatarUrl: githubUser.avatarUrl,
        createdAt: null,
      };
      return response;
    }

    const response: UserProfileResponse = {
      id: user.id,
      githubId: user.githubId,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
    };

    return response;
  });

  /**
   * GET /api/vaults
   * Return all vaults owned or accessible by the user
   */
  fastify.get('/vaults', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const githubUser = request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      // User has no vaults yet
      const response: VaultListResponse = {
        vaults: [],
        total: 0,
      };
      return response;
    }

    // Get all vaults owned by user
    const ownedVaults = await db.query.vaults.findMany({
      where: eq(vaults.ownerId, user.id),
      with: {
        secrets: true,
      },
      orderBy: [desc(vaults.updatedAt)],
    });

    // Build vault list with metadata
    const vaultList: VaultListItem[] = ownedVaults.map((vault) => {
      const [repoOwner, repoName] = vault.repoFullName.split('/');

      // Get unique environments from secrets
      const environments = [...new Set(vault.secrets.map(s => s.environment))];
      if (environments.length === 0) {
        environments.push('default');
      }

      return {
        id: vault.id,
        repoOwner,
        repoName,
        repoAvatar: getGitHubAvatarUrl(repoOwner),
        secretCount: vault.secrets.length,
        environments,
        updatedAt: vault.updatedAt.toISOString(),
      };
    });

    const response: VaultListResponse = {
      vaults: vaultList,
      total: vaultList.length,
    };

    return response;
  });

  /**
   * GET /api/vaults/:vaultId
   * Return vault metadata only (no secrets)
   */
  fastify.get('/vaults/:vaultId', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { vaultId } = VaultIdParamSchema.parse(request.params);
    const accessToken = request.accessToken!;

    // Get vault with secrets count
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.id, vaultId),
      with: {
        secrets: true,
        owner: true,
      },
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Verify user has access to the repository
    const hasAccess = await hasRepoAccess(accessToken, vault.repoFullName);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have access to this vault');
    }

    const [repoOwner, repoName] = vault.repoFullName.split('/');

    // Get unique environments
    const environments = [...new Set(vault.secrets.map(s => s.environment))];
    if (environments.length === 0) {
      environments.push('default');
    }

    const response: VaultMetadataResponse = {
      id: vault.id,
      repoFullName: vault.repoFullName,
      repoOwner,
      repoName,
      repoAvatar: getGitHubAvatarUrl(repoOwner),
      secretCount: vault.secrets.length,
      environments,
      createdAt: vault.createdAt.toISOString(),
      updatedAt: vault.updatedAt.toISOString(),
    };

    return response;
  });

  /**
   * GET /api/vaults/:vaultId/secrets
   * Return the list of secrets WITHOUT values
   */
  fastify.get('/vaults/:vaultId/secrets', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { vaultId } = VaultIdParamSchema.parse(request.params);
    const accessToken = request.accessToken!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.id, vaultId),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Verify user has access to the repository
    const hasAccess = await hasRepoAccess(accessToken, vault.repoFullName);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have access to this vault');
    }

    // Get all secrets for this vault (without encrypted values)
    const vaultSecrets = await db.query.secrets.findMany({
      where: eq(secrets.vaultId, vaultId),
      orderBy: [desc(secrets.updatedAt)],
    });

    const secretList: SecretListItem[] = vaultSecrets.map((secret) => ({
      id: secret.id,
      key: secret.key,
      environment: secret.environment,
      createdAt: secret.createdAt.toISOString(),
      updatedAt: secret.updatedAt.toISOString(),
    }));

    const response: SecretListResponse = {
      secrets: secretList,
      total: secretList.length,
    };

    return response;
  });

  /**
   * POST /api/vaults/:vaultId/secrets
   * Create OR update a secret (upsert)
   */
  fastify.post('/vaults/:vaultId/secrets', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { vaultId } = VaultIdParamSchema.parse(request.params);
    const body = UpsertSecretRequestSchema.parse(request.body);
    const githubUser = request.githubUser!;
    const accessToken = request.accessToken!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.id, vaultId),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Verify user has access to the repository
    const hasAccess = await hasRepoAccess(accessToken, vault.repoFullName);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have access to this vault');
    }

    // Get user for activity logging
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      throw new ForbiddenError('User not found in database');
    }

    // Encrypt the secret value
    const encryptedData = encrypt(body.value);

    fastify.log.info({
      vaultId,
      key: body.key,
      environment: body.environment,
      valuePreview: sanitizeForLogging(body.value),
    }, 'Upserting secret');

    // Check if secret already exists for this key+environment
    const existingSecret = await db.query.secrets.findFirst({
      where: and(
        eq(secrets.vaultId, vaultId),
        eq(secrets.key, body.key),
        eq(secrets.environment, body.environment)
      ),
    });

    let secretId: string;
    let status: 'created' | 'updated';

    if (existingSecret) {
      // Update existing secret
      await db
        .update(secrets)
        .set({
          encryptedValue: encryptedData.encryptedContent,
          iv: encryptedData.iv,
          authTag: encryptedData.authTag,
          updatedAt: new Date(),
        })
        .where(eq(secrets.id, existingSecret.id));

      secretId = existingSecret.id;
      status = 'updated';

      // Log activity
      await logActivity(
        user.id,
        'secret_updated',
        'web',
        vaultId,
        { key: body.key, environment: body.environment },
        request
      );
    } else {
      // Create new secret
      const [newSecret] = await db
        .insert(secrets)
        .values({
          vaultId,
          key: body.key,
          environment: body.environment,
          encryptedValue: encryptedData.encryptedContent,
          iv: encryptedData.iv,
          authTag: encryptedData.authTag,
        })
        .returning();

      secretId = newSecret.id;
      status = 'created';

      // Log activity
      await logActivity(
        user.id,
        'secret_created',
        'web',
        vaultId,
        { key: body.key, environment: body.environment },
        request
      );
    }

    // Update vault's updatedAt timestamp
    await db
      .update(vaults)
      .set({ updatedAt: new Date() })
      .where(eq(vaults.id, vaultId));

    // Track analytics
    trackEvent(user.id, AnalyticsEvents.SECRETS_PUSHED, {
      repoFullName: vault.repoFullName,
      environment: body.environment,
      action: status,
    });

    fastify.log.info({
      vaultId,
      secretId,
      key: body.key,
      environment: body.environment,
      status,
    }, `Secret ${status}`);

    const response: UpsertSecretResponse = {
      id: secretId,
      status,
    };

    return reply.status(status === 'created' ? 201 : 200).send(response);
  });

  /**
   * GET /api/activity
   * Return a list of historical actions for this user
   */
  fastify.get('/activity', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const githubUser = request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      const response: ActivityLogResponse = {
        activities: [],
        total: 0,
      };
      return response;
    }

    // Get activity logs for this user (limit to last 200)
    const logs = await db.query.activityLogs.findMany({
      where: eq(activityLogs.userId, user.id),
      with: {
        user: true,
        vault: true,
      },
      orderBy: [desc(activityLogs.createdAt)],
      limit: 200,
    });

    const activities: ActivityLogItem[] = logs.map((log) => ({
      id: log.id,
      action: log.action,
      vaultId: log.vaultId,
      repoFullName: log.vault?.repoFullName || null,
      actor: {
        id: log.user.id,
        username: log.user.username,
        avatarUrl: log.user.avatarUrl,
      },
      platform: log.platform,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
      timestamp: log.createdAt.toISOString(),
    }));

    const response: ActivityLogResponse = {
      activities,
      total: activities.length,
    };

    return response;
  });

  /**
   * DELETE /api/vaults/:vaultId/secrets/:secretId
   * Delete a secret
   */
  fastify.delete('/vaults/:vaultId/secrets/:secretId', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { vaultId, secretId } = VaultSecretIdParamSchema.parse(request.params);
    const githubUser = request.githubUser!;
    const accessToken = request.accessToken!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.id, vaultId),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Verify user has access to the repository
    const hasAccess = await hasRepoAccess(accessToken, vault.repoFullName);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have access to this vault');
    }

    // Get secret
    const secret = await db.query.secrets.findFirst({
      where: and(
        eq(secrets.id, secretId),
        eq(secrets.vaultId, vaultId)
      ),
    });

    if (!secret) {
      throw new NotFoundError('Secret not found');
    }

    // Get user for activity logging
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      throw new ForbiddenError('User not found in database');
    }

    // Delete the secret
    await db.delete(secrets).where(eq(secrets.id, secretId));

    // Log activity
    await logActivity(
      user.id,
      'secret_deleted',
      'web',
      vaultId,
      { key: secret.key, environment: secret.environment },
      request
    );

    // Update vault's updatedAt timestamp
    await db
      .update(vaults)
      .set({ updatedAt: new Date() })
      .where(eq(vaults.id, vaultId));

    fastify.log.info({
      vaultId,
      secretId,
      key: secret.key,
      environment: secret.environment,
    }, 'Secret deleted');

    return { success: true, message: 'Secret deleted' };
  });
}
