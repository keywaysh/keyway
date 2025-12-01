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

    const callbackUri = buildCallbackUrl(request, providerName);
    const { url: authUrl, codeVerifier } = provider.getAuthorizationUrl('', callbackUri);

    // Sign state to prevent CSRF (include codeVerifier for PKCE)
    const state = signState({
      type: 'provider_oauth',
      provider: providerName,
      userId: request.githubUser!.githubId,
      redirectUri: validatedRedirectUri,
      codeVerifier, // Store for token exchange
    });

    // Replace empty state in URL with signed state
    const finalUrl = authUrl.replace('state=', `state=${encodeURIComponent(state)}`);

    return reply.redirect(finalUrl);
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

      // Exchange code for token (include codeVerifier for PKCE if present)
      const callbackUri = buildCallbackUrl(request, providerName);
      const codeVerifier = stateData.codeVerifier as string | undefined;
      const tokenResponse = await provider.exchangeCodeForToken(query.code, callbackUri, codeVerifier);

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

// Keyway logo SVG
const keywayLogoSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="logo-icon">
  <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor"/>
  <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// Provider icons
const providerIcons: Record<string, string> = {
  vercel: `<svg viewBox="0 0 76 65" fill="currentColor" class="provider-icon"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>`,
};

// HTML template helpers
function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - ${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
      border: 1px solid #e5e7eb;
      text-align: center;
    }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 32px;
      color: #111827;
      font-weight: 700;
      font-size: 20px;
    }
    .logo-icon {
      width: 28px;
      height: 28px;
      color: #10b981;
    }
    .icon-container {
      width: 56px;
      height: 56px;
      background: #fef2f2;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon-container svg {
      width: 28px;
      height: 28px;
      color: #dc2626;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 8px;
    }
    p {
      color: #6b7280;
      line-height: 1.6;
      font-size: 15px;
    }
    .help-link {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .help-link a {
      color: #10b981;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
    }
    .help-link a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      ${keywayLogoSvg}
      <span>Keyway</span>
    </div>
    <div class="icon-container">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="help-link">
      <a href="https://keyway.sh">Return to Keyway</a>
    </div>
  </div>
</body>
</html>`;
}

function renderSuccessPage(provider: string, username: string): string {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
  const providerIcon = providerIcons[provider] || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - Connected to ${providerName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
      border: 1px solid #e5e7eb;
      text-align: center;
    }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 32px;
      color: #111827;
      font-weight: 700;
      font-size: 20px;
    }
    .logo-icon {
      width: 28px;
      height: 28px;
      color: #10b981;
    }
    .success-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #ecfdf5;
      color: #059669;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 24px;
    }
    .success-badge svg {
      width: 16px;
      height: 16px;
    }
    .provider-box {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      background: #f9fafb;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .provider-icon-wrapper {
      width: 40px;
      height: 40px;
      background: #111827;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .provider-icon {
      width: 20px;
      height: 20px;
      color: white;
    }
    .provider-name {
      font-weight: 600;
      color: #111827;
      font-size: 16px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 8px;
    }
    p {
      color: #6b7280;
      line-height: 1.6;
      font-size: 15px;
    }
    .user-info {
      margin-top: 24px;
      padding: 12px 16px;
      background: #f9fafb;
      border-radius: 8px;
      font-size: 14px;
      color: #374151;
    }
    .user-info strong {
      color: #111827;
    }
    .terminal-hint {
      margin-top: 32px;
      padding: 16px;
      background: #111827;
      border-radius: 10px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
      color: #9ca3af;
      text-align: left;
    }
    .terminal-hint .prompt {
      color: #10b981;
    }
    .terminal-hint .command {
      color: white;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      ${keywayLogoSvg}
      <span>Keyway</span>
    </div>
    <div class="success-badge">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
      </svg>
      Connected successfully
    </div>
    <div class="provider-box">
      <div class="provider-icon-wrapper">
        ${providerIcon}
      </div>
      <span class="provider-name">${providerName}</span>
    </div>
    <h1>You're all set!</h1>
    <p>Your ${providerName} account is now connected to Keyway. You can close this window and return to your terminal.</p>
    <div class="user-info">
      <strong>Connected as:</strong> ${username}
    </div>
    <div class="terminal-hint">
      <span class="prompt">$</span> <span class="command">keyway sync ${provider}</span>
    </div>
  </div>
</body>
</html>`;
}
