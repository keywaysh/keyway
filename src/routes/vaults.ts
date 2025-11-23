import { FastifyInstance } from 'fastify';
import {
  InitVaultRequestSchema,
  PushSecretsRequestSchema,
} from '../types';
import { db, users, vaults, secrets } from '../db';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt, sanitizeForLogging } from '../utils/encryption';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import { authenticateGitHub, requireAdminAccess, requireRepoAccess } from '../middleware/auth';
import { ConflictError, NotFoundError } from '../errors';

export async function vaultRoutes(fastify: FastifyInstance) {
  /**
   * POST /vaults/init
   * Initialize a new vault for a repository
   */
  fastify.post('/init', {
    preHandler: [authenticateGitHub, requireAdminAccess]
  }, async (request, reply) => {
    const body = InitVaultRequestSchema.parse(request.body);
    const githubUser = request.githubUser!;
    const accessToken = request.accessToken!;

    // Get or create user in our database
    let user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          githubId: githubUser.githubId,
          username: githubUser.username,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
          accessToken,
        })
        .returning();

      user = newUser;
    }

    // Check if vault already exists
    const existingVault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, body.repoFullName),
    });

    if (existingVault) {
      throw new ConflictError('Vault already exists for this repository');
    }

    // Create vault
    const [vault] = await db
      .insert(vaults)
      .values({
        repoFullName: body.repoFullName,
        ownerId: user.id,
      })
      .returning();

    // Track event
    trackEvent(user.id, AnalyticsEvents.VAULT_INITIALIZED, {
      repoFullName: body.repoFullName,
    });

    fastify.log.info({
      repoFullName: body.repoFullName,
      userId: user.id,
      vaultId: vault.id,
    }, 'Vault initialized');

    return {
      vaultId: vault.id,
      repoFullName: vault.repoFullName,
      message: 'Vault initialized successfully',
    };
  });

  /**
   * POST /vaults/:repo/:env/push
   * Push secrets to a vault environment
   */
  fastify.post('/:repo/:env/push', {
    preHandler: [authenticateGitHub, requireRepoAccess]
  }, async (request, reply) => {
    const params = request.params as { repo: string; env: string };
    const repoFullName = decodeURIComponent(params.repo);
    const environment = params.env;

    const body = PushSecretsRequestSchema.parse({
      ...(request.body as any),
      repoFullName,
      environment,
    });

    const githubUser = request.githubUser!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found. Run keyway init first.');
    }

    // Encrypt the content
    const encryptedData = encrypt(body.content);

    fastify.log.info({
      repoFullName,
      environment,
      contentPreview: sanitizeForLogging(body.content),
    }, 'Pushing secrets');

    // Check if secrets already exist for this environment
    const existingSecret = await db.query.secrets.findFirst({
      where: and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, environment)
      ),
    });

    if (existingSecret) {
      // Update existing secrets
      await db
        .update(secrets)
        .set({
          encryptedContent: encryptedData.encryptedContent,
          iv: encryptedData.iv,
          authTag: encryptedData.authTag,
          updatedAt: new Date(),
        })
        .where(eq(secrets.id, existingSecret.id));
    } else {
      // Insert new secrets
      await db.insert(secrets).values({
        vaultId: vault.id,
        environment,
        encryptedContent: encryptedData.encryptedContent,
        iv: encryptedData.iv,
        authTag: encryptedData.authTag,
      });
    }

    // Get user for tracking
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    // Track event
    trackEvent(user?.id || 'anonymous', AnalyticsEvents.SECRETS_PUSHED, {
      repoFullName,
      environment,
    });

    fastify.log.info({
      repoFullName,
      environment,
      userId: user?.id,
    }, 'Secrets pushed successfully');

    return {
      success: true,
      message: 'Secrets pushed successfully',
    };
  });

  /**
   * GET /vaults/:repo/:env/pull
   * Pull secrets from a vault environment
   */
  fastify.get('/:repo/:env/pull', {
    preHandler: [authenticateGitHub, requireRepoAccess]
  }, async (request, reply) => {
    const params = request.params as { repo: string; env: string };
    const repoFullName = decodeURIComponent(params.repo);
    const environment = params.env;

    const githubUser = request.githubUser!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Get secrets for this environment
    const secret = await db.query.secrets.findFirst({
      where: and(eq(secrets.vaultId, vault.id), eq(secrets.environment, environment)),
    });

    if (!secret) {
      throw new NotFoundError(`No secrets found for environment: ${environment}`);
    }

    // Decrypt the content
    const decryptedContent = decrypt({
      encryptedContent: secret.encryptedContent,
      iv: secret.iv,
      authTag: secret.authTag,
    });

    // Get user for tracking
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    // Track event
    trackEvent(user?.id || 'anonymous', AnalyticsEvents.SECRETS_PULLED, {
      repoFullName,
      environment,
    });

    fastify.log.info({
      repoFullName,
      environment,
      userId: user?.id,
      contentPreview: sanitizeForLogging(decryptedContent),
    }, 'Secrets pulled');

    return {
      content: decryptedContent,
    };
  });
}
