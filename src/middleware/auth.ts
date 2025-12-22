import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '../lib';
import { getUserFromToken, getUserRoleWithApp } from '../utils/github';
import { verifyKeywayToken } from '../utils/jwt';
import { decryptAccessToken } from '../utils/tokenEncryption';
import { db, users, vaults, apiKeys } from '../db';
import { eq, and, isNull } from 'drizzle-orm';
import { hasEnvironmentPermission, resolveEffectivePermission } from '../utils/permissions';
import type { PermissionType, ApiKey, ForgeType } from '../db/schema';
import { config } from '../config';
import {
  isKeywayApiKey,
  validateApiKeyFormat,
  hashApiKey,
  hasRequiredScopes,
  type ApiKeyScope,
} from '../utils/apiKeys';

/**
 * Clear both session cookies (keyway_session and keyway_logged_in)
 * Must match the domain/path used when setting them
 */
function clearSessionCookies(request: FastifyRequest, reply: FastifyReply) {
  const isProduction = config.server.isProduction;
  const host = (request.headers.host || '').split(':')[0];
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');

  let domain: string | undefined;
  if (isProduction && !isLocalhost) {
    const parts = host.split('.');
    if (parts.length >= 2) {
      domain = `.${parts.slice(-2).join('.')}`;
    }
  }

  reply.clearCookie('keyway_session', {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    domain,
  });

  reply.clearCookie('keyway_logged_in', {
    path: '/',
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    domain,
  });
}

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    accessToken?: string;
    /** VCS user info (multi-forge support) */
    vcsUser?: {
      forgeType: ForgeType;
      forgeUserId: string;
      username: string;
      email: string | null;
      avatarUrl: string | null;
    };
    /** @deprecated Use vcsUser instead */
    githubUser?: {
      forgeType: ForgeType;
      forgeUserId: string;
      username: string;
      email: string | null;
      avatarUrl: string | null;
    };
    /** Present when authenticated via API key */
    apiKey?: {
      id: string;
      name: string;
      environment: 'live' | 'test';
      scopes: string[];
      userId: string;
    };
  }
}

/**
 * Extract and validate authentication token
 * Supports: Authorization header (Bearer), session cookie, or GitHub access tokens
 */
export async function authenticateGitHub(
  request: FastifyRequest,
  reply: FastifyReply
) {
  let token: string | undefined;

  // Try Authorization header first
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fall back to query param (for CLI OAuth flows opened in browser)
  if (!token) {
    const query = request.query as { token?: string };
    if (query.token) {
      token = query.token;
    }
  }

  // Fall back to session cookie (for web dashboard)
  if (!token) {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';');
      const sessionCookie = cookies.find(c => c.trim().startsWith('keyway_session='));
      if (sessionCookie) {
        token = sessionCookie.split('=')[1]?.trim();
      }
    }
  }

  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  // Log token info for debugging
  const tokenPreview = token.substring(0, 20) + '...' + token.substring(token.length - 10);
  request.log.info({ tokenPreview, tokenLength: token.length }, 'Auth middleware: received token');

  // Step 0: Check if it's a Keyway API key (kw_live_* or kw_test_*)
  if (isKeywayApiKey(token)) {
    request.log.info('Auth middleware: detected Keyway API key');
    await authenticateWithApiKey(request, token);
    return;
  }

  // Step 1: Try to verify as Keyway JWT token
  let payload;
  try {
    payload = verifyKeywayToken(token);
    request.log.info({ userId: payload.userId, username: payload.username }, 'Auth middleware: JWT verified successfully');
  } catch (jwtError) {
    const errorMessage = jwtError instanceof Error ? jwtError.message : 'Unknown error';
    request.log.warn({ error: errorMessage, tokenPreview }, 'Auth middleware: JWT verification failed');

    // If not a valid JWT, try as GitHub access token
    if (jwtError instanceof Error && jwtError.message.includes('Token')) {
      request.log.info({ tokenPreview }, 'Auth middleware: trying as GitHub token');
      try {
        const githubUser = await getUserFromToken(token);
        request.log.info({ forgeUserId: githubUser.forgeUserId, username: githubUser.username }, 'Auth middleware: GitHub token valid');

        // Attach to request for use in route handlers
        request.accessToken = token;
        const vcsUser = {
          forgeType: 'github' as ForgeType,
          forgeUserId: githubUser.forgeUserId,
          username: githubUser.username,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
        };
        request.vcsUser = vcsUser;
        request.githubUser = vcsUser; // Backward compatibility
        return;
      } catch (githubError) {
        const ghErrorMsg = githubError instanceof Error ? githubError.message : 'Unknown error';
        request.log.warn({ error: ghErrorMsg }, 'Auth middleware: GitHub token also invalid');
        clearSessionCookies(request, reply);
        throw new UnauthorizedError('Invalid access token');
      }
    }

    // JWT error (expired, malformed, wrong secret)
    request.log.warn({ error: errorMessage }, 'Auth middleware: JWT error, clearing cookie');
    clearSessionCookies(request, reply);
    throw new UnauthorizedError('Invalid or expired token');
  }

  // Step 2: Get user from database
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });

  if (!user) {
    request.log.warn({ userId: payload.userId }, 'Auth middleware: User not found in DB');
    clearSessionCookies(request, reply);
    throw new UnauthorizedError('Session expired or invalid. Please run `keyway login` to authenticate.');
  }

  // Step 3: Decrypt the GitHub access token stored in DB
  try {
    request.accessToken = await decryptAccessToken({
      encryptedAccessToken: user.encryptedAccessToken,
      accessTokenIv: user.accessTokenIv,
      accessTokenAuthTag: user.accessTokenAuthTag,
      tokenEncryptionVersion: user.tokenEncryptionVersion ?? 1,
    });
    request.log.info({ username: user.username }, 'Auth middleware: GitHub token decrypted successfully');
  } catch (decryptError) {
    const errorMessage = decryptError instanceof Error ? decryptError.message : 'Unknown error';
    request.log.error({ error: errorMessage, userId: user.id }, 'Auth middleware: Failed to decrypt GitHub token');
    throw new UnauthorizedError('Failed to decrypt stored credentials. Please re-authenticate.');
  }

  const vcsUser = {
    forgeType: user.forgeType,
    forgeUserId: user.forgeUserId,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
  request.vcsUser = vcsUser;
  request.githubUser = vcsUser; // Backward compatibility
}

/**
 * Authenticate using Keyway API key (kw_live_* or kw_test_*)
 */
async function authenticateWithApiKey(request: FastifyRequest, token: string) {
  // Validate format
  if (!validateApiKeyFormat(token)) {
    throw new UnauthorizedError('Invalid API key format');
  }

  // Hash the token for lookup
  const keyHash = hashApiKey(token);

  // Find the API key in database
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, keyHash),
      isNull(apiKeys.revokedAt)
    ),
    with: { user: true },
  });

  if (!apiKey) {
    request.log.warn('Auth middleware: API key not found or revoked');
    throw new UnauthorizedError('Invalid or revoked API key');
  }

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    request.log.warn({ apiKeyId: apiKey.id }, 'Auth middleware: API key expired');
    throw new UnauthorizedError('API key has expired');
  }

  // Check IP restriction if configured
  if (apiKey.allowedIps && apiKey.allowedIps.length > 0) {
    const clientIp = request.ip || 'unknown';
    // Simple check - for production, use a proper CIDR matching library
    if (!apiKey.allowedIps.some(ip => ip === clientIp || ip === '0.0.0.0/0')) {
      request.log.warn({ apiKeyId: apiKey.id, clientIp }, 'Auth middleware: IP not allowed');
      throw new UnauthorizedError('IP address not allowed for this API key');
    }
  }

  const user = apiKey.user;
  if (!user) {
    request.log.error({ apiKeyId: apiKey.id }, 'Auth middleware: API key user not found');
    throw new UnauthorizedError('API key owner not found');
  }

  // Update last used timestamp and usage count (fire and forget)
  db.update(apiKeys)
    .set({
      lastUsedAt: new Date(),
      usageCount: (apiKey.usageCount || 0) + 1,
    })
    .where(eq(apiKeys.id, apiKey.id))
    .catch(err => request.log.error(err, 'Failed to update API key usage'));

  // Decrypt the user's GitHub access token for API calls
  try {
    request.accessToken = await decryptAccessToken({
      encryptedAccessToken: user.encryptedAccessToken,
      accessTokenIv: user.accessTokenIv,
      accessTokenAuthTag: user.accessTokenAuthTag,
      tokenEncryptionVersion: user.tokenEncryptionVersion ?? 1,
    });
  } catch (decryptError) {
    const errorMessage = decryptError instanceof Error ? decryptError.message : 'Unknown error';
    request.log.error({ error: errorMessage, userId: user.id }, 'Auth middleware: Failed to decrypt GitHub token for API key');
    throw new UnauthorizedError('Failed to decrypt stored credentials. Please re-authenticate.');
  }

  // Set request context
  const vcsUser = {
    forgeType: user.forgeType,
    forgeUserId: user.forgeUserId,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
  request.vcsUser = vcsUser;
  request.githubUser = vcsUser; // Backward compatibility

  request.apiKey = {
    id: apiKey.id,
    name: apiKey.name,
    environment: apiKey.environment,
    scopes: apiKey.scopes || [],
    userId: user.id,
  };

  request.log.info({
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.name,
    username: user.username,
  }, 'Auth middleware: API key authenticated successfully');
}

/**
 * Verify user has admin access to a repository
 * Uses GitHub App installation token to check permissions
 * Requires authenticateGitHub to be called first
 */
export async function requireAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const vcsUser = request.vcsUser || request.githubUser;
  if (!request.accessToken || !vcsUser) {
    throw new UnauthorizedError('Authentication required');
  }

  // Get repo name from params (owner/repo) or body
  const params = request.params as { owner?: string; repo?: string };
  const body = request.body as { repoFullName?: string };

  const repoFullName = params.owner && params.repo
    ? `${params.owner}/${params.repo}`
    : body?.repoFullName;

  if (!repoFullName) {
    throw new ForbiddenError('Repository name required');
  }

  // Use GitHub App to check user's role on the repo
  const role = await getUserRoleWithApp(repoFullName, vcsUser.username);
  const isAdmin = role === 'admin';

  if (!isAdmin) {
    throw new ForbiddenError('Only repository admins can perform this action');
  }
}

/**
 * Create middleware factory for environment-based permissions
 * Requires authenticateGitHub to be called first
 */
export function requireEnvironmentAccess(permissionType: PermissionType) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const vcsUser = request.vcsUser || request.githubUser;
    if (!request.accessToken || !vcsUser) {
      throw new UnauthorizedError('Authentication required');
    }

    // Get repo and environment from params, query, or body
    const params = request.params as { repo?: string; env?: string };
    const query = request.query as { repo?: string; environment?: string };
    const body = request.body as { repoFullName?: string; environment?: string };

    const repoFullName = params.repo
      ? decodeURIComponent(params.repo)
      : query.repo || body?.repoFullName;

    const environment = params.env || query.environment || body?.environment;

    if (!repoFullName) {
      throw new ForbiddenError('Repository name required');
    }

    if (!environment) {
      throw new ForbiddenError('Environment name required');
    }

    // Get user's role for this repository using GitHub App
    const userRole = await getUserRoleWithApp(
      repoFullName,
      vcsUser.username
    );

    if (!userRole) {
      throw new ForbiddenError('You do not have access to this repository');
    }

    // Get vault for this repository
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new ForbiddenError('Vault not found for this repository');
    }

    // Get user ID for override checking
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    // Check environment permission using the new override-aware system
    const hasPermission = user
      ? await resolveEffectivePermission(
          vault.id,
          environment,
          user.id,
          userRole,
          permissionType
        )
      : await hasEnvironmentPermission(
          vault.id,
          environment,
          userRole,
          permissionType
        );

    if (!hasPermission) {
      const action = permissionType === 'read' ? 'read from' : 'write to';
      throw new ForbiddenError(
        `Your role (${userRole}) does not have permission to ${action} the "${environment}" environment`
      );
    }
  };
}

/**
 * Middleware to validate API key scopes
 * If the request is authenticated via API key, checks that it has the required scopes
 * If not using an API key (JWT, GitHub token, etc.), allows the request to proceed
 */
export function requireApiKeyScope(...requiredScopes: ApiKeyScope[]) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    // If not authenticated via API key, allow (other auth methods have full access)
    if (!request.apiKey) {
      return;
    }

    // Check if API key has required scopes
    if (!hasRequiredScopes(request.apiKey.scopes, requiredScopes)) {
      throw new ForbiddenError(
        `API key missing required scope(s): ${requiredScopes.join(', ')}`
      );
    }
  };
}
