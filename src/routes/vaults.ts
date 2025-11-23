import { FastifyInstance } from 'fastify';
import {
  InitVaultRequestSchema,
  PushSecretsRequestSchema,
  PullSecretsRequestSchema,
} from '../types';
import { db, users, vaults, secrets } from '../db';
import { eq, and } from 'drizzle-orm';
import { getUserFromToken, hasRepoAccess } from '../utils/github';
import { encrypt, decrypt, sanitizeForLogging } from '../utils/encryption';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';

export async function vaultRoutes(fastify: FastifyInstance) {
  /**
   * POST /vaults/init
   * Initialize a new vault for a repository
   */
  fastify.post('/vaults/init', async (request, reply) => {
    try {
      const body = InitVaultRequestSchema.parse(request.body);

      // Verify GitHub token and get user
      const githubUser = await getUserFromToken(body.accessToken);

      // Check if user has access to the repository
      const hasAccess = await hasRepoAccess(body.accessToken, body.repoFullName);

      if (!hasAccess) {
        return reply.status(403).send({
          error: 'ForbiddenError',
          message: 'You do not have access to this repository',
        });
      }

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
            accessToken: body.accessToken,
          })
          .returning();

        user = newUser;
      }

      // Check if vault already exists
      const existingVault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, body.repoFullName),
      });

      if (existingVault) {
        return reply.status(409).send({
          error: 'ConflictError',
          message: 'Vault already exists for this repository',
        });
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

      console.log(`Vault initialized for ${body.repoFullName}`);

      return {
        vaultId: vault.id,
        repoFullName: vault.repoFullName,
        message: 'Vault initialized successfully',
      };
    } catch (error) {
      trackEvent('anonymous', AnalyticsEvents.API_ERROR, {
        endpoint: '/vaults/init',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: error.message,
        });
      }

      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to initialize vault',
      });
    }
  });

  /**
   * POST /vaults/:repo/:env/push
   * Push secrets to a vault environment
   */
  fastify.post('/vaults/:repo/:env/push', async (request, reply) => {
    try {
      const params = request.params as { repo: string; env: string };
      const repoFullName = decodeURIComponent(params.repo);
      const environment = params.env;

      const body = PushSecretsRequestSchema.parse({
        ...(request.body as any),
        repoFullName,
        environment,
      });

      // Verify GitHub token and get user
      const githubUser = await getUserFromToken(body.accessToken);

      // Check if user has access to the repository
      const hasAccess = await hasRepoAccess(body.accessToken, body.repoFullName);

      if (!hasAccess) {
        return reply.status(403).send({
          error: 'ForbiddenError',
          message: 'You do not have access to this repository',
        });
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, body.repoFullName),
      });

      if (!vault) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Vault not found. Run keyway init first.',
        });
      }

      // Encrypt the content
      const encryptedData = encrypt(body.content);

      console.log(
        `Pushing secrets for ${body.repoFullName}/${environment}: ${sanitizeForLogging(
          body.content
        )}`
      );

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
        repoFullName: body.repoFullName,
        environment,
      });

      console.log(`Secrets pushed successfully for ${body.repoFullName}/${environment}`);

      return {
        success: true,
        message: 'Secrets pushed successfully',
      };
    } catch (error) {
      trackEvent('anonymous', AnalyticsEvents.API_ERROR, {
        endpoint: '/vaults/push',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: error.message,
        });
      }

      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to push secrets',
      });
    }
  });

  /**
   * GET /vaults/:repo/:env/pull
   * Pull secrets from a vault environment
   */
  fastify.get('/vaults/:repo/:env/pull', async (request, reply) => {
    try {
      const params = request.params as { repo: string; env: string };
      const query = request.query as { accessToken?: string };

      const repoFullName = decodeURIComponent(params.repo);
      const environment = params.env;

      if (!query.accessToken) {
        return reply.status(401).send({
          error: 'UnauthorizedError',
          message: 'Access token is required',
        });
      }

      const accessToken = query.accessToken;

      // Verify GitHub token and get user
      const githubUser = await getUserFromToken(accessToken);

      // Check if user has access to the repository
      const hasAccess = await hasRepoAccess(accessToken, repoFullName);

      if (!hasAccess) {
        return reply.status(403).send({
          error: 'ForbiddenError',
          message: 'You do not have access to this repository',
        });
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Vault not found',
        });
      }

      // Get secrets for this environment
      const secret = await db.query.secrets.findFirst({
        where: and(eq(secrets.vaultId, vault.id), eq(secrets.environment, environment)),
      });

      if (!secret) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: `No secrets found for environment: ${environment}`,
        });
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

      console.log(
        `Secrets pulled for ${repoFullName}/${environment}: ${sanitizeForLogging(
          decryptedContent
        )}`
      );

      return {
        content: decryptedContent,
      };
    } catch (error) {
      trackEvent('anonymous', AnalyticsEvents.API_ERROR, {
        endpoint: '/vaults/pull',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: error.message,
        });
      }

      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to pull secrets',
      });
    }
  });
}
