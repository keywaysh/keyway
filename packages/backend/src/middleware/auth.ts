import { FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError, ForbiddenError } from "../lib";
import { getRepoInfoWithApp, getUserRoleWithApp } from "../utils/github";
import { verifyKeywayToken } from "../utils/jwt";
import { decryptAccessToken } from "../utils/tokenEncryption";
import { db, users, vaults, apiKeys } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { resolveEffectivePermission } from "../utils/permissions";
import type { PermissionType, ForgeType } from "../db/schema";
import { config } from "../config";
import {
  isKeywayApiKey,
  validateApiKeyFormat,
  hashApiKey,
  hasRequiredScopes,
  type ApiKeyScope,
} from "../utils/apiKeys";

/**
 * Clear both session cookies (keyway_session and keyway_logged_in)
 * Must match the domain/path used when setting them
 */
function clearSessionCookies(request: FastifyRequest, reply: FastifyReply) {
  const isProduction = config.server.isProduction;
  const host = (request.headers.host || "").split(":")[0];
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

  let domain: string | undefined;
  if (isProduction && !isLocalhost) {
    const parts = host.split(".");
    if (parts.length >= 2) {
      domain = `.${parts.slice(-2).join(".")}`;
    }
  }

  reply.clearCookie("keyway_session", {
    path: "/",
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    domain,
  });

  reply.clearCookie("keyway_logged_in", {
    path: "/",
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax",
    domain,
  });
}

// Extend Fastify request type
declare module "fastify" {
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
      environment: "live" | "test";
      scopes: string[];
      userId: string;
    };
    /** User's role for the current repository (set by requireEnvironmentAccess) */
    repoRole?: "read" | "triage" | "write" | "maintain" | "admin";
    /** Repository and environment requireEnvironmentAccess checked */
    checkedEnvironment?: { repoFullName: string; environment: string };
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** GitHub token prefixes (classic PAT, fine-grained PAT, OAuth, user-to-server, installation). */
const GITHUB_TOKEN_PREFIXES = ["ghp_", "github_pat_", "gho_", "ghu_", "ghs_", "ghr_"];

/**
 * Cookie sessions are sent by the browser automatically, so a state-changing request
 * authenticated by cookie must come from an allowed front-end origin (CSRF guard).
 * Bearer tokens (CLI, CI, API keys) are never sent automatically and are not checked.
 */
function assertCookieRequestOrigin(request: FastifyRequest) {
  if (SAFE_METHODS.has(request.method) || config.cors.allowAll) {
    return;
  }
  const origin = request.headers.origin;
  if (!origin || !config.cors.allowedOrigins.includes(origin)) {
    request.log.warn({ origin, method: request.method }, "Auth middleware: cookie request from disallowed origin");
    throw new ForbiddenError("Cross-site request rejected");
  }
}

/**
 * Extract and validate authentication token
 * Supports: Authorization header (Bearer: Keyway JWT or API key) or the dashboard session cookie.
 * Tokens are never read from the query string: URLs end up in logs and analytics.
 */
export async function authenticateGitHub(request: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined;

  // Try Authorization header first
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  // Fall back to session cookie (for web dashboard)
  if (!token) {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(";");
      const sessionCookie = cookies.find((c) => c.trim().startsWith("keyway_session="));
      if (sessionCookie) {
        token = sessionCookie.split("=")[1]?.trim();
        if (token) {
          assertCookieRequestOrigin(request);
        }
      }
    }
  }

  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }

  // Log token type and length only — never log token content (OWASP Logging Cheat Sheet)
  const isGitHubToken = GITHUB_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
  const tokenType = isKeywayApiKey(token) ? "api_key" : isGitHubToken ? "github_token" : "jwt";
  request.log.info({ tokenType, tokenLength: token.length }, "Auth middleware: received token");

  // Raw GitHub tokens are deliberately NOT accepted as an identity: repo access is
  // checked with the Keyway GitHub App + username, so any GitHub token (another
  // app's OAuth token, a zero-permission PAT) would otherwise unlock every secret
  // its owner can reach.
  if (isGitHubToken) {
    throw new UnauthorizedError(
      "GitHub tokens are not accepted. Use `keyway login` or a Keyway API key (kw_live_…)."
    );
  }

  // Step 0: Check if it's a Keyway API key (kw_live_* or kw_test_*)
  if (isKeywayApiKey(token)) {
    request.log.info("Auth middleware: detected Keyway API key");
    await authenticateWithApiKey(request, token);
    return;
  }

  // Step 1: Try to verify as Keyway JWT token
  let payload;
  try {
    payload = verifyKeywayToken(token);
    request.log.info(
      { userId: payload.userId, username: payload.username },
      "Auth middleware: JWT verified successfully"
    );
  } catch (jwtError) {
    const errorMessage = jwtError instanceof Error ? jwtError.message : "Unknown error";
    request.log.warn(
      { error: errorMessage, tokenType },
      "Auth middleware: JWT verification failed"
    );

    // JWT error (expired, malformed, wrong secret). Never fall back to treating the
    // token as a GitHub token (see the GitHub token check above).
    request.log.warn({ error: errorMessage }, "Auth middleware: JWT error, clearing cookie");
    clearSessionCookies(request, reply);
    throw new UnauthorizedError("Invalid or expired token");
  }

  // Step 2: Get user from database
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });

  if (!user) {
    request.log.warn({ userId: payload.userId }, "Auth middleware: User not found in DB");
    clearSessionCookies(request, reply);
    throw new UnauthorizedError(
      "Session expired or invalid. Please run `keyway login` to authenticate."
    );
  }

  // Step 3: Decrypt the GitHub access token stored in DB
  try {
    request.accessToken = await decryptAccessToken({
      encryptedAccessToken: user.encryptedAccessToken,
      accessTokenIv: user.accessTokenIv,
      accessTokenAuthTag: user.accessTokenAuthTag,
      tokenEncryptionVersion: user.tokenEncryptionVersion ?? 1,
    });
    request.log.info(
      { username: user.username },
      "Auth middleware: GitHub token decrypted successfully"
    );
  } catch (decryptError) {
    const errorMessage = decryptError instanceof Error ? decryptError.message : "Unknown error";
    request.log.error(
      { error: errorMessage, userId: user.id },
      "Auth middleware: Failed to decrypt GitHub token"
    );
    throw new UnauthorizedError("Failed to decrypt stored credentials. Please re-authenticate.");
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
    throw new UnauthorizedError("Invalid API key format");
  }

  // Hash the token for lookup
  const keyHash = hashApiKey(token);

  // Find the API key in database
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
    with: { user: true },
  });

  if (!apiKey) {
    request.log.warn("Auth middleware: API key not found or revoked");
    throw new UnauthorizedError("Invalid or revoked API key");
  }

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    request.log.warn({ apiKeyId: apiKey.id }, "Auth middleware: API key expired");
    throw new UnauthorizedError("API key has expired");
  }

  // Check IP restriction if configured
  if (apiKey.allowedIps && apiKey.allowedIps.length > 0) {
    const clientIp = request.ip || "unknown";
    // Simple check - for production, use a proper CIDR matching library
    if (!apiKey.allowedIps.some((ip) => ip === clientIp || ip === "0.0.0.0/0")) {
      request.log.warn({ apiKeyId: apiKey.id, clientIp }, "Auth middleware: IP not allowed");
      throw new UnauthorizedError("IP address not allowed for this API key");
    }
  }

  const user = apiKey.user;
  if (!user) {
    request.log.error({ apiKeyId: apiKey.id }, "Auth middleware: API key user not found");
    throw new UnauthorizedError("API key owner not found");
  }

  // Update last used timestamp and usage count (fire and forget)
  db.update(apiKeys)
    .set({
      lastUsedAt: new Date(),
      usageCount: (apiKey.usageCount || 0) + 1,
    })
    .where(eq(apiKeys.id, apiKey.id))
    .catch((err) => request.log.error(err, "Failed to update API key usage"));

  // Decrypt the user's GitHub access token for API calls
  try {
    request.accessToken = await decryptAccessToken({
      encryptedAccessToken: user.encryptedAccessToken,
      accessTokenIv: user.accessTokenIv,
      accessTokenAuthTag: user.accessTokenAuthTag,
      tokenEncryptionVersion: user.tokenEncryptionVersion ?? 1,
    });
  } catch (decryptError) {
    const errorMessage = decryptError instanceof Error ? decryptError.message : "Unknown error";
    request.log.error(
      { error: errorMessage, userId: user.id },
      "Auth middleware: Failed to decrypt GitHub token for API key"
    );
    throw new UnauthorizedError("Failed to decrypt stored credentials. Please re-authenticate.");
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

  request.log.info(
    {
      apiKeyId: apiKey.id,
      apiKeyName: apiKey.name,
      username: user.username,
    },
    "Auth middleware: API key authenticated successfully"
  );
}

/**
 * Repo id binding for the vault stored under this exact name: its forgeRepoId,
 * `null` when the vault exists but is unbound (grants nothing), or `undefined`
 * when there is no vault (e.g. creating one: nothing to bind to).
 */
async function getVaultForgeRepoId(repoFullName: string): Promise<string | null | undefined> {
  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
  });
  return vault ? vault.forgeRepoId : undefined;
}

/**
 * Verify user has admin access to a repository
 * Uses GitHub App installation token to check permissions
 * Requires authenticateGitHub to be called first
 */
export async function requireAdminAccess(request: FastifyRequest, _reply: FastifyReply) {
  const vcsUser = request.vcsUser || request.githubUser;
  if (!request.accessToken || !vcsUser) {
    throw new UnauthorizedError("Authentication required");
  }

  // Repo from the route params when the route has them, otherwise from the body
  // (never mix: the check must cover the repo the handler acts on)
  const params = request.params as { owner?: string; repo?: string };
  const body = request.body as { repoFullName?: string };

  const repoFullName =
    "owner" in params || "repo" in params
      ? `${params.owner}/${params.repo}`
      : body?.repoFullName;

  if (!repoFullName) {
    throw new ForbiddenError("Repository name required");
  }

  // Use GitHub App to check user's role on the repo the vault is bound to
  const role = await getUserRoleWithApp(repoFullName, vcsUser, {
    expectedRepoId: await getVaultForgeRepoId(repoFullName),
  });
  const isAdmin = role === "admin";

  if (!isAdmin) {
    throw new ForbiddenError("Only repository admins can perform this action");
  }
}

/**
 * Like requireAdminAccess, but lets the vault's owner act on an orphaned vault:
 * the repo is inaccessible (deleted, App uninstalled), the vault is not bound to a
 * repository id, or its name now points to a different repository.
 * Use only for destructive operations like vault deletion.
 */
export async function requireAdminOrOwnerAccess(request: FastifyRequest, _reply: FastifyReply) {
  const vcsUser = request.vcsUser || request.githubUser;
  if (!request.accessToken || !vcsUser) {
    throw new UnauthorizedError("Authentication required");
  }

  const params = request.params as { owner?: string; repo?: string };
  const repoFullName =
    params.owner && params.repo ? `${params.owner}/${params.repo}` : undefined;

  if (!repoFullName) {
    throw new ForbiddenError("Repository name required");
  }

  // Compare the immutable forge identity: usernames can be released and re-registered
  const isVaultOwner = async () => {
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
      with: { owner: true },
    });
    return (
      !!vault &&
      vault.owner.forgeType === vcsUser.forgeType &&
      vault.owner.forgeUserId === vcsUser.forgeUserId
    );
  };

  const expectedRepoId = await getVaultForgeRepoId(repoFullName);
  let role;
  try {
    role = await getUserRoleWithApp(repoFullName, vcsUser, { expectedRepoId });
  } catch (err) {
    // App not installed, or vault not bound to a repository id: the repo can't vouch
    // for anyone, only the vault owner may clean the vault up.
    if (err instanceof ForbiddenError) {
      if (await isVaultOwner()) {
        return;
      }
      throw new ForbiddenError("Only the vault owner can delete a vault when the repo is inaccessible");
    }
    throw err;
  }

  if (role === "admin") {
    return;
  }

  // The name now points to another repository (deleted and re-created, or reused):
  // nobody is admin of the vault's repository any more, its owner may delete it.
  if (typeof expectedRepoId === "string") {
    const current = await getRepoInfoWithApp(repoFullName).catch(() => null);
    if (current?.repoId && current.repoId !== expectedRepoId && (await isVaultOwner())) {
      return;
    }
  }

  throw new ForbiddenError("Only repository admins can perform this action");
}

/**
 * Create middleware factory for environment-based permissions
 * Requires authenticateGitHub to be called first
 */
export function requireEnvironmentAccess(permissionType: PermissionType) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const vcsUser = request.vcsUser || request.githubUser;
    if (!request.accessToken || !vcsUser) {
      throw new UnauthorizedError("Authentication required");
    }

    // Get repo (query or body, validated by the v1 router) and environment
    const params = request.params as { env?: string };
    const query = request.query as { repo?: string; environment?: string };
    const body = request.body as { repoFullName?: string; environment?: string };

    const repoFullName = query.repo || body?.repoFullName;

    const environment = params.env || query.environment || body?.environment;

    if (!repoFullName) {
      throw new ForbiddenError("Repository name required");
    }

    if (!environment) {
      throw new ForbiddenError("Environment name required");
    }

    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    // Role check bound to the vault's immutable repo id: a name that now points to
    // another repository (rename, transfer, deleted and recreated) grants nothing.
    const userRole = await getUserRoleWithApp(repoFullName, vcsUser, {
      expectedRepoId: vault?.forgeRepoId,
    });

    if (!userRole) {
      throw new ForbiddenError("You do not have access to this repository");
    }

    // Attach role to request for use in route handlers (e.g., exposure tracking)
    request.repoRole = userRole;

    if (!vault) {
      throw new ForbiddenError("Vault not found for this repository");
    }

    // Overrides, org defaults and environment types are keyed by Keyway user:
    // every caller must have one (JWT and API keys always do).
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });
    if (!user) {
      throw new ForbiddenError("A Keyway account is required to access secrets");
    }

    const hasPermission = await resolveEffectivePermission(
      vault.id,
      environment,
      user.id,
      userRole,
      permissionType
    );

    if (!hasPermission) {
      const action = permissionType === "read" ? "read from" : "write to";
      throw new ForbiddenError(
        `Your role (${userRole}) does not have permission to ${action} the "${environment}" environment`
      );
    }
    request.checkedEnvironment = { repoFullName, environment };
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
      throw new ForbiddenError(`API key missing required scope(s): ${requiredScopes.join(", ")}`);
    }
  };
}

/**
 * Middleware for administrative actions (permissions, organizations, billing) that no
 * API key scope covers: refuse API-key auth whatever its scopes, so a leaked CI key
 * can't change who has access. Requires authenticateGitHub first.
 */
export function rejectApiKeyAuth(action: string) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    if (request.apiKey) {
      throw new ForbiddenError(
        `API keys cannot ${action}. Sign in to Keyway with GitHub to do this.`
      );
    }
  };
}
