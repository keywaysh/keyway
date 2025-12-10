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
  getSyncDiff,
  getSyncPreview,
  executeSync,
  getConnectionToken,
} from '../../../services/integration.service';
import { signState, verifyState } from '../../../utils/state';
import { config } from '../../../config';
import { db, vaults, users } from '../../../db';
import { eq } from 'drizzle-orm';
import { NotFoundError, ForbiddenError, BadRequestError, PlanLimitError } from '../../../lib';
import { getUserRoleWithApp } from '../../../utils/github';
import { providerConnections } from '../../../db/schema';
import { and } from 'drizzle-orm';
import { sendData, sendNoContent } from '../../../lib/response';
import { canConnectProvider } from '../../../config/plans';
import { logActivity, extractRequestInfo, detectPlatform } from '../../../services';

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
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  keywayEnvironment: z.string().default('production'),
  providerEnvironment: z.string().default('production'),
  direction: z.enum(['push', 'pull']).default('push'),
  allowDelete: z.boolean().default(false),
});

const SyncPreviewQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  keywayEnvironment: z.string().optional().default('production'),
  providerEnvironment: z.string().optional().default('production'),
  direction: z.enum(['push', 'pull']).optional().default('push'),
  allowDelete: z.string().optional().transform(v => v === 'true'),
});

const SyncStatusQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  environment: z.string().optional().default('production'),
});

const SyncDiffQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  keywayEnvironment: z.string().optional().default('production'),
  providerEnvironment: z.string().optional().default('production'),
});

// Helper to build callback URL
function buildCallbackUrl(request: { headers: { 'x-forwarded-proto'?: string; host?: string }; hostname: string }, provider: string): string {
  const protocol = request.headers['x-forwarded-proto'] || (config.server.isDevelopment ? 'http' : 'https');
  const host = request.headers.host || request.hostname;
  return `${protocol}://${host}/v1/integrations/${provider}/callback`;
}

// Helper to verify vault access
// Uses GitHub App to check permissions (consistent with other access checks)
async function verifyVaultAccess(username: string, owner: string, repo: string) {
  const repoFullName = `${owner}/${repo}`;
  console.log(`[Integrations] verifyVaultAccess: user='${username}', repo='${repoFullName}'`);

  // Use GitHub App to check user's role (same as requireEnvironmentAccess middleware)
  const role = await getUserRoleWithApp(repoFullName, username);

  if (!role) {
    console.warn(`[Integrations] Access denied: user='${username}' has no role on '${repoFullName}'`);
    throw new ForbiddenError('You do not have access to this repository');
  }

  console.log(`[Integrations] Access granted: user='${username}', role='${role}' on '${repoFullName}'`);

  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
  });

  if (!vault) {
    console.warn(`[Integrations] Vault not found for repo: ${repoFullName}`);
    throw new NotFoundError('Vault not found');
  }

  console.log(`[Integrations] Vault found: id=${vault.id}, repo=${repoFullName}`);
  return vault;
}

// Helper to verify vault access with write permission (for sync push)
async function verifyVaultWriteAccess(username: string, owner: string, repo: string) {
  const repoFullName = `${owner}/${repo}`;
  console.log(`[Integrations] verifyVaultWriteAccess: user='${username}', repo='${repoFullName}'`);

  // Get user's role to check write permission (using GitHub App)
  const role = await getUserRoleWithApp(repoFullName, username);

  if (!role) {
    console.warn(`[Integrations] Write access denied: user='${username}' has no role on '${repoFullName}'`);
    throw new ForbiddenError('You do not have access to this repository');
  }

  // write, maintain, admin can write
  const canWrite = ['write', 'maintain', 'admin'].includes(role);
  if (!canWrite) {
    console.warn(`[Integrations] Write access denied: user='${username}' has role='${role}' (need write/maintain/admin)`);
    throw new ForbiddenError('You need write access to this repository to sync secrets');
  }

  console.log(`[Integrations] Write access granted: user='${username}', role='${role}' on '${repoFullName}'`);

  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
  });

  if (!vault) {
    console.warn(`[Integrations] Vault not found for repo: ${repoFullName}`);
    throw new NotFoundError('Vault not found');
  }

  return vault;
}

export async function integrationsRoutes(fastify: FastifyInstance) {
  /**
   * GET /integrations
   * List available providers
   */
  fastify.get('/', async (request, reply) => {
    return sendData(reply, {
      providers: getAvailableProviders(),
    }, { requestId: request.id });
  });

  /**
   * GET /integrations/connections
   * List user's provider connections
   */
  fastify.get('/connections', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    // Get user from DB to get the UUID
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const connections = await listConnections(user.id);
    return sendData(reply, { connections }, { requestId: request.id });
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

    // Get connection info before deletion for logging
    const connection = await db.query.providerConnections.findFirst({
      where: and(
        eq(providerConnections.id, id),
        eq(providerConnections.userId, user.id)
      ),
    });

    const deleted = await deleteConnection(user.id, id);

    if (!deleted) {
      throw new NotFoundError('Connection not found');
    }

    // Log integration disconnected (no vaultId since it's user-level)
    const { ipAddress, userAgent } = extractRequestInfo(request);
    await logActivity({
      userId: user.id,
      action: 'integration_disconnected',
      platform: detectPlatform(userAgent),
      ipAddress,
      userAgent,
      metadata: { provider: connection?.provider },
    });

    return sendNoContent(reply);
  });

  /**
   * POST /integrations/:provider/connect
   * Connect with API token (for providers like Railway that don't use OAuth)
   */
  fastify.post('/:provider/connect', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };
    const body = request.body as { token?: string };

    if (!body.token) {
      throw new BadRequestError('Token is required');
    }

    const provider = getProvider(providerName);
    if (!provider) {
      throw new NotFoundError(`Provider ${providerName} not found`);
    }

    // Only allow token-based auth for specific providers
    const tokenAuthProviders = ['railway'];
    if (!tokenAuthProviders.includes(providerName)) {
      throw new BadRequestError(`Provider ${providerName} requires OAuth authentication`);
    }

    // Get Keyway user
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check provider limit before creating connection
    const existingConnections = await listConnections(user.id);
    const providerCheck = canConnectProvider(user.plan, existingConnections.length);
    if (!providerCheck.allowed) {
      throw new PlanLimitError(providerCheck.reason || 'Provider limit reached');
    }

    // Validate token by fetching user info
    let providerUser;
    try {
      providerUser = await provider.getUser(body.token);
    } catch (error) {
      throw new BadRequestError('Invalid API token. Please check your token and try again.');
    }

    // Store connection (no refresh token or expiry for API tokens)
    await createConnection(
      user.id,
      providerName,
      body.token,
      { id: providerUser.id, teamId: providerUser.teamId },
      undefined, // no refresh token
      undefined, // no expiry
      undefined  // no scopes
    );

    // Log integration connected
    const { ipAddress, userAgent } = extractRequestInfo(request);
    await logActivity({
      userId: user.id,
      action: 'integration_connected',
      platform: detectPlatform(userAgent),
      ipAddress,
      userAgent,
      metadata: { provider: providerName },
    });

    return sendData(reply, {
      success: true,
      provider: providerName,
      user: {
        id: providerUser.id,
        username: providerUser.username,
        email: providerUser.email,
        teamName: providerUser.teamName,
      },
    }, { requestId: request.id });
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

    // Check provider limit BEFORE redirecting to OAuth
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    const existingConnections = await listConnections(user.id);
    const providerCheck = canConnectProvider(user.plan, existingConnections.length);
    if (!providerCheck.allowed) {
      throw new PlanLimitError(providerCheck.reason || 'Provider limit reached');
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

      // Check provider limit before creating connection
      const existingConnections = await listConnections(user.id);
      const providerCheck = canConnectProvider(user.plan, existingConnections.length);
      if (!providerCheck.allowed) {
        return reply.type('text/html').send(renderErrorPage(
          'Provider Limit Reached',
          `${providerCheck.reason} <a href="https://keyway.sh/upgrade">Upgrade your plan</a> to connect more providers.`
        ));
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

      // Log integration connected
      const { ipAddress, userAgent } = extractRequestInfo(request);
      await logActivity({
        userId: user.id,
        action: 'integration_connected',
        platform: detectPlatform(userAgent),
        ipAddress,
        userAgent,
        metadata: { provider: providerName },
      });

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
  }, async (request, reply) => {
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
    return sendData(reply, { projects }, { requestId: request.id });
  });

  /**
   * GET /vaults/:owner/:repo/sync/status
   * Get sync status for first-time detection
   */
  fastify.get('/vaults/:owner/:repo/sync/status', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const query = SyncStatusQuerySchema.parse(request.query);

    const vault = await verifyVaultAccess(request.githubUser!.username, owner, repo);

    // Get the authenticated user for ownership validation
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // For Railway: append serviceId to environment (format: "production:serviceId")
    const providerEnv = query.serviceId
      ? `${query.environment}:${query.serviceId}`
      : query.environment;

    const status = await getSyncStatus(
      vault.id,
      query.connectionId,
      query.projectId,
      providerEnv,
      user.id
    );

    return sendData(reply, status, { requestId: request.id });
  });

  /**
   * GET /vaults/:owner/:repo/sync/diff
   * Get bi-directional diff between Keyway vault and provider
   */
  fastify.get('/vaults/:owner/:repo/sync/diff', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const query = SyncDiffQuerySchema.parse(request.query);

    const vault = await verifyVaultAccess(request.githubUser!.username, owner, repo);

    // Get the authenticated user for ownership validation
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // For Railway: append serviceId to providerEnvironment (format: "production:serviceId")
    const providerEnv = query.serviceId
      ? `${query.providerEnvironment}:${query.serviceId}`
      : query.providerEnvironment;

    const diff = await getSyncDiff(
      vault.id,
      query.connectionId,
      query.projectId,
      query.keywayEnvironment,
      providerEnv,
      user.id
    );

    return sendData(reply, diff, { requestId: request.id });
  });

  /**
   * GET /vaults/:owner/:repo/sync/preview
   * Preview what would change during a sync
   */
  fastify.get('/vaults/:owner/:repo/sync/preview', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const query = SyncPreviewQuerySchema.parse(request.query);

    const vault = await verifyVaultAccess(request.githubUser!.username, owner, repo);

    // Get the authenticated user for ownership validation
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // For Railway: append serviceId to providerEnvironment (format: "production:serviceId")
    const providerEnv = query.serviceId
      ? `${query.providerEnvironment}:${query.serviceId}`
      : query.providerEnvironment;

    const preview = await getSyncPreview(
      vault.id,
      query.connectionId,
      query.projectId,
      query.keywayEnvironment,
      providerEnv,
      query.direction,
      query.allowDelete || false,
      user.id
    );

    return sendData(reply, preview, { requestId: request.id });
  });

  /**
   * POST /vaults/:owner/:repo/sync
   * Execute a sync operation
   */
  fastify.post('/vaults/:owner/:repo/sync', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { owner, repo } = request.params as { owner: string; repo: string };
    const body = SyncBodySchema.parse(request.body);

    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // For push operations, require write access to the repository
    // For pull operations, read access is sufficient
    let vault;
    if (body.direction === 'push') {
      vault = await verifyVaultWriteAccess(request.githubUser!.username, owner, repo);
    } else {
      vault = await verifyVaultAccess(request.githubUser!.username, owner, repo);
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

    // For Railway: append serviceId to providerEnvironment (format: "production:serviceId")
    const providerEnv = body.serviceId
      ? `${body.providerEnvironment}:${body.serviceId}`
      : body.providerEnvironment;

    const result = await executeSync(
      vault.id,
      body.connectionId,
      body.projectId,
      body.keywayEnvironment,
      providerEnv,
      body.direction,
      body.allowDelete,
      user.id
    );

    // Log secrets synced (only on success)
    if (result.status === 'success') {
      const { ipAddress, userAgent } = extractRequestInfo(request);
      await logActivity({
        userId: user.id,
        vaultId: vault.id,
        action: 'secrets_synced',
        platform: detectPlatform(userAgent),
        ipAddress,
        userAgent,
        metadata: {
          provider: connection.provider,
          direction: body.direction,
          environment: body.keywayEnvironment,
          count: result.created + result.updated + result.deleted,
        },
      });
    }

    return sendData(reply, {
      success: result.status === 'success',
      stats: {
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        skipped: result.skipped,
        total: result.created + result.updated + result.deleted,
      },
      error: result.error,
    }, { requestId: request.id });
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
