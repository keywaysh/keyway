/**
 * Integration Routes
 * Handles OAuth flows and sync operations with external providers (Vercel, Netlify, etc.)
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateGitHub } from '../../../middleware/auth';
import { getProvider, getAvailableProviders } from '../../../services/providers';
import {
  getConnection,
  listConnections,
  createConnection,
  deleteConnection,
  listProviderProjects,
  getSyncStatus,
  getSyncPreview,
  executeSync,
  getConnectionToken,
} from '../../../services/integration.service';
import { signState, verifyState } from '../../../utils/state';
import { config } from '../../../config';
import { db, vaults, users } from '../../../db';
import { eq } from 'drizzle-orm';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../../lib';
import { hasRepoAccess } from '../../../utils/github';
import { providerConnections } from '../../../db/schema';
import { and } from 'drizzle-orm';

// Allowed redirect origins for OAuth callbacks
const ALLOWED_REDIRECT_ORIGINS = [
  // Production
  'https://keyway.sh',
  'https://api.keyway.sh',
  // Test/Staging
  'https://keyway.cloud',
  'https://api.keyway.cloud',
  // Local development
  'http://localhost:3000',
  'http://localhost:5173',
];

// Schemas
const SyncBodySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  keywayEnvironment: z.string().default('production'),
  providerEnvironment: z.string().default('production'),
  direction: z.enum(['push', 'pull']).default('push'),
  allowDelete: z.boolean().default(false),
});

const SyncPreviewQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  keywayEnvironment: z.string().optional().default('production'),
  providerEnvironment: z.string().optional().default('production'),
  direction: z.enum(['push', 'pull']).optional().default('push'),
  allowDelete: z.string().optional().transform(v => v === 'true'),
});

const SyncStatusQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  environment: z.string().optional().default('production'),
});

// Helper to build callback URL
function buildCallbackUrl(request: { headers: { 'x-forwarded-proto'?: string; host?: string }; hostname: string }, provider: string): string {
  const protocol = request.headers['x-forwarded-proto'] || (config.server.isDevelopment ? 'http' : 'https');
  const host = request.headers.host || request.hostname;
  return `${protocol}://${host}/v1/integrations/${provider}/callback`;
}

// Helper to verify vault access
async function verifyVaultAccess(accessToken: string, owner: string, repo: string) {
  const repoFullName = `${owner}/${repo}`;
  const hasAccess = await hasRepoAccess(accessToken, repoFullName);
  if (!hasAccess) {
    throw new ForbiddenError('You do not have access to this repository');
  }

  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
  });

  if (!vault) {
    throw new NotFoundError('Vault not found');
  }

  return vault;
}

export async function integrationsRoutes(fastify: FastifyInstance) {
  /**
   * GET /integrations
   * List available providers
   */
  fastify.get('/', async () => {
    return {
      providers: getAvailableProviders(),
    };
  });

  /**
   * GET /integrations/connections
   * List user's provider connections
   */
  fastify.get('/connections', {
    preHandler: [authenticateGitHub],
  }, async (request) => {
    const userId = request.githubUser!.githubId.toString();

    // Get user from DB to get the UUID
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const connections = await listConnections(user.id);
    return { connections };
  });

  /**
   * DELETE /integrations/connections/:id
   * Delete a provider connection
   */
  fastify.delete('/connections/:id', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const deleted = await deleteConnection(user.id, id);

    if (!deleted) {
      throw new NotFoundError('Connection not found');
    }

    return { success: true };
  });

  /**
   * GET /integrations/:provider/authorize
   * Start OAuth flow for a provider
   */
  fastify.get('/:provider/authorize', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };
    const query = request.query as { redirect_uri?: string };

    const provider = getProvider(providerName);
    if (!provider) {
      throw new NotFoundError(`Provider ${providerName} not found`);
    }

    // Validate redirect_uri upfront if provided (prevents signing invalid URIs)
    let validatedRedirectUri: string | null = null;
    if (query.redirect_uri) {
      try {
        const url = new URL(query.redirect_uri);
        if (!ALLOWED_REDIRECT_ORIGINS.includes(url.origin)) {
          throw new ForbiddenError(`Invalid redirect origin: ${url.origin}`);
        }
        validatedRedirectUri = query.redirect_uri;
      } catch (e) {
        if (e instanceof ForbiddenError) throw e;
        throw new ForbiddenError('Invalid redirect URI format');
      }
    }

    // Sign state to prevent CSRF
    const state = signState({
      type: 'provider_oauth',
      provider: providerName,
      userId: request.githubUser!.githubId,
      redirectUri: validatedRedirectUri,
    });

    const callbackUri = buildCallbackUrl(request, providerName);
    const authUrl = provider.getAuthorizationUrl(state, callbackUri);

    return reply.redirect(authUrl);
  });

  /**
   * GET /integrations/:provider/callback
   * OAuth callback for a provider
   */
  fastify.get('/:provider/callback', async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };

    if (query.error) {
      fastify.log.warn({ error: query.error, description: query.error_description }, 'Provider OAuth error');
      return reply.type('text/html').send(renderErrorPage('Authorization Denied', query.error_description || 'You denied the authorization request.'));
    }

    if (!query.code || !query.state) {
      throw new BadRequestError('Missing code or state parameter');
    }

    const provider = getProvider(providerName);
    if (!provider) {
      throw new NotFoundError(`Provider ${providerName} not found`);
    }

    try {
      // Verify state
      const stateData = verifyState(query.state);
      if (!stateData || stateData.type !== 'provider_oauth' || stateData.provider !== providerName) {
        throw new BadRequestError('Invalid or tampered state parameter');
      }

      // Exchange code for token
      const callbackUri = buildCallbackUrl(request, providerName);
      const tokenResponse = await provider.exchangeCodeForToken(query.code, callbackUri);

      // Get provider user info
      const providerUser = await provider.getUser(tokenResponse.accessToken);

      // Get Keyway user
      const user = await db.query.users.findFirst({
        where: eq(users.githubId, stateData.userId as number),
      });

      if (!user) {
        throw new NotFoundError('User not found. Please log in again.');
      }

      // Store connection
      await createConnection(
        user.id,
        providerName,
        tokenResponse.accessToken,
        { id: providerUser.id, teamId: providerUser.teamId },
        tokenResponse.refreshToken,
        tokenResponse.expiresIn ? new Date(Date.now() + tokenResponse.expiresIn * 1000) : undefined,
        tokenResponse.scope?.split(' ')
      );

      // Redirect to success page or redirect_uri (with validation)
      const redirectUri = stateData.redirectUri as string | null;
      if (redirectUri) {
        try {
          const url = new URL(redirectUri);
          if (!ALLOWED_REDIRECT_ORIGINS.includes(url.origin)) {
            fastify.log.warn({ redirectUri, origin: url.origin }, 'Invalid redirect origin attempted');
            // Fall through to success page instead of open redirect
          } else {
            return reply.redirect(redirectUri);
          }
        } catch {
          fastify.log.warn({ redirectUri }, 'Invalid redirect URI format');
          // Fall through to success page
        }
      }

      return reply.type('text/html').send(renderSuccessPage(providerName, providerUser.username));

    } catch (error) {
      fastify.log.error({
        err: error,
        provider: providerName,
      }, 'Provider OAuth callback error');

      return reply.type('text/html').send(renderErrorPage('Connection Failed', 'An error occurred while connecting. Please try again.'));
    }
  });

  /**
   * GET /integrations/connections/:id/projects
   * List projects for a connection
   */
  fastify.get('/connections/:id/projects', {
    preHandler: [authenticateGitHub],
  }, async (request) => {
    const { id } = request.params as { id: string };

    // Get the authenticated user
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // listProviderProjects now requires userId for ownership validation
    const projects = await listProviderProjects(id, user.id);
    return { projects };
  });

  /**
   * GET /vaults/:owner/:repo/sync/status
   * Get sync status for first-time detection
   */
  fastify.get('/vaults/:owner/:repo/sync/status', {
    preHandler: [authenticateGitHub],
  }, async (request) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const query = SyncStatusQuerySchema.parse(request.query);

    const vault = await verifyVaultAccess(request.accessToken!, owner, repo);

    // Get the authenticated user for ownership validation
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const status = await getSyncStatus(
      vault.id,
      query.connectionId,
      query.projectId,
      query.environment,
      user.id
    );

    return status;
  });

  /**
   * GET /vaults/:owner/:repo/sync/preview
   * Preview what would change during a sync
   */
  fastify.get('/vaults/:owner/:repo/sync/preview', {
    preHandler: [authenticateGitHub],
  }, async (request) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const query = SyncPreviewQuerySchema.parse(request.query);

    const vault = await verifyVaultAccess(request.accessToken!, owner, repo);

    // Get the authenticated user for ownership validation
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const preview = await getSyncPreview(
      vault.id,
      query.connectionId,
      query.projectId,
      query.keywayEnvironment,
      query.providerEnvironment,
      query.direction,
      query.allowDelete || false,
      user.id
    );

    return preview;
  });

  /**
   * POST /vaults/:owner/:repo/sync
   * Execute a sync operation
   */
  fastify.post('/vaults/:owner/:repo/sync', {
    preHandler: [authenticateGitHub],
  }, async (request) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const body = SyncBodySchema.parse(request.body);

    const vault = await verifyVaultAccess(request.accessToken!, owner, repo);

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify the connection belongs to the authenticated user
    const connection = await db.query.providerConnections.findFirst({
      where: and(
        eq(providerConnections.id, body.connectionId),
        eq(providerConnections.userId, user.id)
      ),
    });

    if (!connection) {
      throw new ForbiddenError('Connection not found or does not belong to you');
    }

    const result = await executeSync(
      vault.id,
      body.connectionId,
      body.projectId,
      body.keywayEnvironment,
      body.providerEnvironment,
      body.direction,
      body.allowDelete,
      user.id
    );

    return {
      success: result.status === 'success',
      stats: {
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        skipped: result.skipped,
        total: result.created + result.updated + result.deleted,
      },
      error: result.error,
    };
  });
}

// HTML template helpers
function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
    h1 { font-size: 28px; margin-bottom: 12px; color: #c53030; }
    p { color: #4a5568; margin-bottom: 24px; line-height: 1.6; }
    .logo { font-size: 48px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">⚠️</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

function renderSuccessPage(provider: string, username: string): string {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - Connected to ${providerName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
    h1 { font-size: 28px; margin-bottom: 12px; color: #38a169; }
    p { color: #4a5568; margin-bottom: 24px; line-height: 1.6; }
    .logo { font-size: 48px; margin-bottom: 20px; }
    .user-info { background: #f7fafc; padding: 16px; border-radius: 8px; margin-top: 20px; }
    .user-info strong { color: #2d3748; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">✅</div>
    <h1>Connected to ${providerName}!</h1>
    <p>You have successfully connected your ${providerName} account. You can now close this window and return to the terminal.</p>
    <div class="user-info"><strong>Connected as:</strong> ${username}</div>
  </div>
</body>
</html>`;
}
