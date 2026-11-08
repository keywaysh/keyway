/**
 * Integration Routes
 * Handles OAuth flows and sync operations with external providers (Vercel, Netlify, etc.)
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { z } from "zod";
import { authenticateGitHub, requireApiKeyScope } from "../../../middleware/auth";
import { hasRequiredScopes } from "../../../utils/apiKeys";
import { getProvider, getAvailableProviders } from "../../../services/providers";
import {
  listConnections,
  createConnection,
  deleteConnection,
  listProviderProjects,
  listAllProviderProjects,
  linkVaultToProject,
  getSyncStatus,
  getSyncDiff,
  getSyncPreview,
  executeSync,
} from "../../../services/integration.service";
import {
  signState,
  verifyState,
  createStateNonce,
  stateNonceMatches,
  signTicket,
  peekTicket,
  redeemTicket,
  STATE_NONCE_MAX_AGE_SECONDS,
} from "../../../utils/state";
import { verifyKeywayToken } from "../../../utils/jwt";
import { escapeHtml } from "../../../utils/html";
import { config } from "../../../config";
import { db, vaults, users } from "../../../db";
import { eq } from "drizzle-orm";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  PlanLimitError,
  UnauthorizedError,
} from "../../../lib";
import type { ForgeType } from "../../../db/schema";
import { getUserRoleWithApp } from "../../../utils/github";
import { requireSyncPermission, requireEnvironmentPermission } from "../../../utils/permissions";
import { logger } from "../../../utils/sharedLogger";
import { providerConnections } from "../../../db/schema";
import { and } from "drizzle-orm";
import { sendData, sendNoContent } from "../../../lib/response";
import { canConnectProvider } from "../../../config/plans";
import { logActivity, extractRequestInfo, detectPlatform } from "../../../services";

// Build allowed redirect origins from config
function getAllowedRedirectOrigins(): string[] {
  const origins = new Set<string>();

  // Add configured origins
  if (config.app?.frontendUrl) {
    origins.add(new URL(config.app.frontendUrl).origin);
  }
  if (config.app?.dashboardUrl) {
    origins.add(new URL(config.app.dashboardUrl).origin);
  }

  // Add explicitly configured CORS origins
  for (const origin of config.cors?.allowedOrigins || []) {
    try {
      origins.add(new URL(origin).origin);
    } catch {
      origins.add(origin);
    }
  }

  // Always allow localhost in development
  if (config.server.isDevelopment) {
    origins.add("http://localhost:3000");
    origins.add("http://localhost:5173");
  }

  return Array.from(origins);
}

// Schemas
const SyncBodySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  keywayEnvironment: z.string().default("production"),
  providerEnvironment: z.string().default("production"),
  direction: z.enum(["push", "pull"]).default("push"),
  allowDelete: z.boolean().default(false),
});

const SyncPreviewQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  keywayEnvironment: z.string().optional().default("production"),
  providerEnvironment: z.string().optional().default("production"),
  direction: z.enum(["push", "pull"]).optional().default("push"),
  allowDelete: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const SyncStatusQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  environment: z.string().optional().default("production"),
});

const SyncDiffQuerySchema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string(),
  serviceId: z.string().optional(), // Railway: service ID for service-specific variables
  keywayEnvironment: z.string().optional().default("production"),
  providerEnvironment: z.string().optional().default("production"),
});

// Helper to build absolute URLs on this API (same host the request came to)
function buildApiUrl(
  request: { headers: { "x-forwarded-proto"?: string; host?: string }; hostname: string },
  path: string
): string {
  const protocol =
    request.headers["x-forwarded-proto"] || (config.server.isDevelopment ? "http" : "https");
  const host = request.headers.host || request.hostname;
  return `${protocol}://${host}${path}`;
}

// Helper to build callback URL
function buildCallbackUrl(
  request: { headers: { "x-forwarded-proto"?: string; host?: string }; hostname: string },
  provider: string
): string {
  return buildApiUrl(request, `/v1/integrations/${provider}/callback`);
}

/**
 * Nonce cookie binding the provider OAuth state to the browser that started it:
 * a state, or a provider consent URL carrying it, sent to someone else cannot attach
 * their provider account to the initiator's Keyway account.
 */
const PROVIDER_NONCE_COOKIE = "keyway_provider_oauth_nonce";

function providerNonceCookieOptions(provider: string) {
  return {
    path: `/v1/integrations/${provider}/callback`,
    httpOnly: true,
    secure: config.server.isProduction,
    sameSite: "lax" as const,
  };
}

/**
 * Single-use ticket for GET /:provider/authorize: the CLI gets a URL to open in the
 * browser without its long-lived token in it. It only starts this provider's OAuth flow,
 * and only in a browser signed in to Keyway as the ticket's owner, so its 10 minutes
 * (time for a GitHub sign-in round trip) give nothing to anyone who copies it.
 * One redemption per API instance (see redeemTicket).
 */
const AUTHORIZE_TICKET_TYPE = "provider_authorize_ticket";
const AUTHORIZE_TICKET_TTL_SECONDS = 10 * 60;

/** Calls a Fastify preHandler outside the hook chain, async or callback style. */
function runPreHandler(hook: unknown, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => (err ? reject(err) : resolve());
    const result = (hook as (r: FastifyRequest, p: FastifyReply, d: typeof done) => unknown)(
      request,
      reply,
      done
    );
    if (result instanceof Promise) {
      result.then(() => resolve(), reject);
    }
  });
}

const SESSION_COOKIE = "keyway_session";
// The web login, which binds its state to the browser; same API host (auth.routes.ts)
const WEB_LOGIN_PATH = "/v1/auth/github/start";

type ForgeIdentity = { forgeType: ForgeType; forgeUserId: string; username: string };

const INVALID_TICKET_MESSAGE =
  "This authorization link is invalid, expired or already used. Run the command again.";

/** The owner named by a valid authorize ticket for this provider, or null. */
function ticketOwner(
  ticket: Record<string, unknown> | null,
  provider: string
): ForgeIdentity | null {
  if (
    !ticket ||
    ticket.provider !== provider ||
    typeof ticket.forgeType !== "string" ||
    typeof ticket.forgeUserId !== "string" ||
    typeof ticket.username !== "string"
  ) {
    return null;
  }
  return {
    forgeType: ticket.forgeType as ForgeType,
    forgeUserId: ticket.forgeUserId,
    username: ticket.username,
  };
}

/**
 * The Keyway user of this browser's dashboard session cookie, verified like
 * authenticateGitHub verifies it (Keyway JWT, user still in the database); null if the
 * browser has no valid session.
 */
async function getBrowserSessionUser(request: FastifyRequest) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  let payload;
  try {
    payload = verifyKeywayToken(token);
  } catch {
    return null;
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, payload.userId) });
  return user ?? null;
}

function isSameForgeUser(a: Omit<ForgeIdentity, "username">, b: Omit<ForgeIdentity, "username">) {
  return a.forgeType === b.forgeType && a.forgeUserId === b.forgeUserId;
}

/** HTML page: this browser must be signed in to Keyway as the owner of the link. */
function sendSignInRequiredPage(
  reply: FastifyReply,
  provider: string,
  ownerUsername: string,
  sessionUsername: string | null
) {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
  const message = sessionUsername
    ? `This browser is signed in to Keyway as @${sessionUsername}, but this link was created for @${ownerUsername}. ` +
      `Sign in to Keyway in this browser as @${ownerUsername}, then run the command again to connect ${providerName}.`
    : `To connect ${providerName}, sign in to Keyway in this browser as @${ownerUsername}, then run the command again.`;
  return reply
    .status(sessionUsername ? 403 : 401)
    .type("text/html")
    .send(renderErrorPage("Sign in to Keyway", message));
}

/**
 * Authentication of GET /:provider/authorize, which a browser opens:
 * - `?ticket=` from POST /:provider/authorize-ticket (current CLI);
 * - `?token=` from CLI versions before the ticket: accepted on this route only, by moving
 *   it into the Authorization header (the middleware no longer reads it from the URL);
 * - otherwise the usual Bearer header or session cookie.
 *
 * A ticket or query token is a link anyone can be sent: it starts the provider OAuth only
 * in a browser signed in to Keyway (session cookie) as its owner. Otherwise the victim's
 * browser would get a valid nonce cookie for a state naming the link's owner, and the
 * victim's provider account would be connected to the owner's Keyway account.
 */
async function authenticateAuthorizeRequest(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as { ticket?: unknown; token?: unknown; after_login?: unknown };
  const { provider } = request.params as { provider: string };

  if (query.ticket !== undefined) {
    const ticket = typeof query.ticket === "string" ? query.ticket : "";
    // Checked, not spent: the owner may have to sign in first and come back with it
    const owner = ticketOwner(peekTicket(ticket, AUTHORIZE_TICKET_TYPE), provider);
    if (!owner) {
      throw new UnauthorizedError(INVALID_TICKET_MESSAGE);
    }

    const sessionUser = await getBrowserSessionUser(request);
    if (!sessionUser || !isSameForgeUser(sessionUser, owner)) {
      if (!sessionUser && query.after_login === undefined) {
        // Sign in through the web login and come back here (once: after_login stops a loop)
        const returnTo =
          `/v1/integrations/${encodeURIComponent(provider)}/authorize` +
          `?ticket=${encodeURIComponent(ticket)}&after_login=1`;
        return reply.redirect(`${WEB_LOGIN_PATH}?redirect_uri=${encodeURIComponent(returnTo)}`);
      }
      return sendSignInRequiredPage(reply, provider, owner.username, sessionUser?.username ?? null);
    }

    if (!redeemTicket(ticket, AUTHORIZE_TICKET_TYPE)) {
      throw new UnauthorizedError(INVALID_TICKET_MESSAGE);
    }
    const vcsUser = { ...owner, email: null, avatarUrl: null };
    request.vcsUser = vcsUser;
    request.githubUser = vcsUser;
    return;
  }

  if (typeof query.token === "string" && query.token && !request.headers.authorization) {
    request.headers.authorization = `Bearer ${query.token}`;
    await runPreHandler(authenticateGitHub, request, reply);

    const owner = request.vcsUser ?? request.githubUser;
    if (!owner) {
      throw new UnauthorizedError("Authentication required");
    }
    const sessionUser = await getBrowserSessionUser(request);
    if (!sessionUser || !isSameForgeUser(sessionUser, owner)) {
      // No sign-in round trip here: the return URL would carry the long-lived token
      return sendSignInRequiredPage(reply, provider, owner.username, sessionUser?.username ?? null);
    }
    return;
  }

  await runPreHandler(authenticateGitHub, request, reply);
}

// Helper to verify vault access
// Uses GitHub App to check permissions (consistent with other access checks).
// Returns the role it checked: environment permission checks must use that role, never a
// second lookup that could come back null (rate limit, outage) and be skipped.
async function verifyVaultAccess(username: string, owner: string, repo: string) {
  const repoFullName = `${owner}/${repo}`;
  logger.debug({ username, repoFullName }, "Verifying vault access");

  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.repoFullName, repoFullName),
  });

  // Use GitHub App to check user's role (same as requireEnvironmentAccess middleware),
  // bound to the vault's immutable repo id
  const role = await getUserRoleWithApp(repoFullName, username, {
    expectedRepoId: vault?.forgeRepoId,
  });

  if (!role) {
    logger.warn({ username, repoFullName }, "Access denied: user has no role on repository");
    throw new ForbiddenError("You do not have access to this repository");
  }

  logger.debug({ username, role, repoFullName }, "Access granted");

  if (!vault) {
    logger.warn({ repoFullName }, "Vault not found for repository");
    throw new NotFoundError("Vault not found");
  }

  logger.debug({ vaultId: vault.id, repoFullName }, "Vault found");
  return { vault, role };
}

export async function integrationsRoutes(fastify: FastifyInstance) {
  // The OAuth flow needs cookies (state nonce); index.ts registers the plugin globally
  if (!fastify.hasReplyDecorator("setCookie")) {
    await fastify.register(cookie);
  }

  /**
   * GET /integrations
   * List available providers
   */
  fastify.get("/", async (request, reply) => {
    return sendData(
      reply,
      {
        providers: getAvailableProviders(),
      },
      { requestId: request.id }
    );
  });

  /**
   * GET /integrations/connections
   * List user's provider connections
   */
  fastify.get(
    "/connections",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      // Get user from DB to get the UUID
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      const connections = await listConnections(user.id);
      return sendData(reply, { connections }, { requestId: request.id });
    }
  );

  /**
   * DELETE /integrations/connections/:id
   * Delete a provider connection
   */
  fastify.delete(
    "/connections/:id",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Get connection info before deletion for logging
      const connection = await db.query.providerConnections.findFirst({
        where: and(eq(providerConnections.id, id), eq(providerConnections.userId, user.id)),
      });

      const deleted = await deleteConnection(user.id, id);

      if (!deleted) {
        throw new NotFoundError("Connection not found");
      }

      // Log integration disconnected (no vaultId since it's user-level)
      const { ipAddress, userAgent } = extractRequestInfo(request);
      await logActivity({
        userId: user.id,
        action: "integration_disconnected",
        platform: detectPlatform(userAgent),
        ipAddress,
        userAgent,
        metadata: { provider: connection?.provider },
      });

      return sendNoContent(reply);
    }
  );

  /**
   * POST /integrations/:provider/connect
   * Connect with API token (for providers like Railway that don't use OAuth)
   */
  fastify.post(
    "/:provider/connect",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const { provider: providerName } = request.params as { provider: string };
      const body = request.body as { token?: string };

      if (!body.token) {
        throw new BadRequestError("Token is required");
      }

      const provider = getProvider(providerName);
      if (!provider) {
        throw new NotFoundError(`Provider ${providerName} not found`);
      }

      // Only allow token-based auth for specific providers
      const tokenAuthProviders = ["railway"];
      if (!tokenAuthProviders.includes(providerName)) {
        throw new BadRequestError(`Provider ${providerName} requires OAuth authentication`);
      }

      // Get Keyway user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Check provider limit before creating connection
      const existingConnections = await listConnections(user.id);
      const providerCheck = canConnectProvider(user.plan, existingConnections.length);
      if (!providerCheck.allowed) {
        throw new PlanLimitError(providerCheck.reason || "Provider limit reached");
      }

      // Validate token by fetching user info
      let providerUser;
      try {
        providerUser = await provider.getUser(body.token);
      } catch (_error) {
        throw new BadRequestError("Invalid API token. Please check your token and try again.");
      }

      // Store connection (no refresh token or expiry for API tokens)
      await createConnection(
        user.id,
        providerName,
        body.token,
        { id: providerUser.id, teamId: providerUser.teamId },
        undefined, // no refresh token
        undefined, // no expiry
        undefined // no scopes
      );

      // Log integration connected
      const { ipAddress, userAgent } = extractRequestInfo(request);
      await logActivity({
        userId: user.id,
        action: "integration_connected",
        platform: detectPlatform(userAgent),
        ipAddress,
        userAgent,
        metadata: { provider: providerName },
      });

      return sendData(
        reply,
        {
          success: true,
          provider: providerName,
          user: {
            id: providerUser.id,
            username: providerUser.username,
            email: providerUser.email,
            teamName: providerUser.teamName,
          },
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /integrations/:provider/authorize-ticket
   * Returns the URL the CLI opens in the browser to start the provider OAuth flow:
   * GET /:provider/authorize with a single-use ticket instead of the CLI's token
   */
  fastify.post(
    "/:provider/authorize-ticket",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const { provider: providerName } = request.params as { provider: string };

      if (!getProvider(providerName)) {
        throw new NotFoundError(`Provider ${providerName} not found`);
      }

      const vcsUser = request.vcsUser || request.githubUser!;
      const ticket = signTicket(
        {
          type: AUTHORIZE_TICKET_TYPE,
          provider: providerName,
          forgeType: vcsUser.forgeType,
          forgeUserId: vcsUser.forgeUserId,
          username: vcsUser.username,
        },
        AUTHORIZE_TICKET_TTL_SECONDS * 1000
      );

      const url = buildApiUrl(
        request,
        `/v1/integrations/${encodeURIComponent(providerName)}/authorize?ticket=${encodeURIComponent(ticket)}`
      );

      return sendData(
        reply,
        { url, expiresIn: AUTHORIZE_TICKET_TTL_SECONDS },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /integrations/:provider/authorize
   * Start OAuth flow for a provider
   */
  fastify.get(
    "/:provider/authorize",
    {
      preHandler: [authenticateAuthorizeRequest, requireApiKeyScope("write:secrets")],
    },
    async (request, reply) => {
      const { provider: providerName } = request.params as { provider: string };
      const query = request.query as { redirect_uri?: string };

      const provider = getProvider(providerName);
      if (!provider) {
        throw new NotFoundError(`Provider ${providerName} not found`);
      }

      // Check provider limit BEFORE redirecting to OAuth
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });
      if (!user) {
        throw new NotFoundError("User not found");
      }
      const existingConnections = await listConnections(user.id);
      const providerCheck = canConnectProvider(user.plan, existingConnections.length);
      if (!providerCheck.allowed) {
        throw new PlanLimitError(providerCheck.reason || "Provider limit reached");
      }

      // Validate redirect_uri upfront if provided (prevents signing invalid URIs)
      let validatedRedirectUri: string | null = null;
      if (query.redirect_uri) {
        try {
          const url = new URL(query.redirect_uri);
          if (!getAllowedRedirectOrigins().includes(url.origin)) {
            throw new ForbiddenError(`Invalid redirect origin: ${url.origin}`);
          }
          validatedRedirectUri = query.redirect_uri;
        } catch (e) {
          if (e instanceof ForbiddenError) {
            throw e;
          }
          throw new ForbiddenError("Invalid redirect URI format");
        }
      }

      const callbackUri = buildCallbackUrl(request, providerName);
      const { url: authUrl, codeVerifier } = provider.getAuthorizationUrl("", callbackUri);

      // Bind the flow to this browser: the callback requires this nonce
      const { nonce, nonceHash } = createStateNonce();
      reply.setCookie(PROVIDER_NONCE_COOKIE, nonce, {
        ...providerNonceCookieOptions(providerName),
        maxAge: STATE_NONCE_MAX_AGE_SECONDS,
      });

      // Sign state to prevent CSRF (include codeVerifier for PKCE)
      const vcsUser = request.vcsUser || request.githubUser!;
      const state = signState({
        type: "provider_oauth",
        provider: providerName,
        forgeType: vcsUser.forgeType,
        forgeUserId: vcsUser.forgeUserId,
        redirectUri: validatedRedirectUri,
        codeVerifier, // Store for token exchange
        nonceHash,
      });

      // Replace empty state in URL with signed state
      const finalUrl = authUrl.replace("state=", `state=${encodeURIComponent(state)}`);

      return reply.redirect(finalUrl);
    }
  );

  /**
   * GET /integrations/:provider/callback
   * OAuth callback for a provider
   */
  fastify.get("/:provider/callback", async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    if (query.error) {
      fastify.log.warn(
        { error: query.error, description: query.error_description },
        "Provider OAuth error"
      );
      return reply
        .type("text/html")
        .send(
          renderErrorPage(
            "Authorization Denied",
            query.error_description || "You denied the authorization request."
          )
        );
    }

    if (!query.code || !query.state) {
      throw new BadRequestError("Missing code or state parameter");
    }

    const provider = getProvider(providerName);
    if (!provider) {
      throw new NotFoundError(`Provider ${providerName} not found`);
    }

    // The nonce is single-use whatever the outcome
    const browserNonce = request.cookies?.[PROVIDER_NONCE_COOKIE];
    reply.clearCookie(PROVIDER_NONCE_COOKIE, providerNonceCookieOptions(providerName));

    try {
      // Verify state
      const stateData = verifyState(query.state);
      if (
        !stateData ||
        stateData.type !== "provider_oauth" ||
        stateData.provider !== providerName
      ) {
        throw new BadRequestError("Invalid or tampered state parameter");
      }
      // ...and that it comes back to the browser that started the flow
      if (!stateNonceMatches(stateData, browserNonce)) {
        throw new BadRequestError("OAuth state was not started in this browser");
      }

      // Exchange code for token (include codeVerifier for PKCE if present)
      const callbackUri = buildCallbackUrl(request, providerName);
      const codeVerifier = stateData.codeVerifier as string | undefined;
      const tokenResponse = await provider.exchangeCodeForToken(
        query.code,
        callbackUri,
        codeVerifier
      );

      // Get provider user info
      const providerUser = await provider.getUser(tokenResponse.accessToken);

      // Get Keyway user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, stateData.forgeType as "github" | "gitlab" | "bitbucket"),
          eq(users.forgeUserId, stateData.forgeUserId as string)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found. Please log in again.");
      }

      // Check provider limit before creating connection
      const existingConnections = await listConnections(user.id);
      const providerCheck = canConnectProvider(user.plan, existingConnections.length);
      if (!providerCheck.allowed) {
        return reply
          .type("text/html")
          .send(
            renderErrorPage(
              "Provider Limit Reached",
              providerCheck.reason || "Provider limit reached.",
              `${config.app?.frontendUrl || ""}/upgrade`
            )
          );
      }

      // Store connection
      await createConnection(
        user.id,
        providerName,
        tokenResponse.accessToken,
        { id: providerUser.id, teamId: providerUser.teamId },
        tokenResponse.refreshToken,
        tokenResponse.expiresIn ? new Date(Date.now() + tokenResponse.expiresIn * 1000) : undefined,
        tokenResponse.scope?.split(" ")
      );

      // Log integration connected
      const { ipAddress, userAgent } = extractRequestInfo(request);
      await logActivity({
        userId: user.id,
        action: "integration_connected",
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
          if (!getAllowedRedirectOrigins().includes(url.origin)) {
            fastify.log.warn(
              { redirectUri, origin: url.origin },
              "Invalid redirect origin attempted"
            );
            // Fall through to success page instead of open redirect
          } else {
            return reply.redirect(redirectUri);
          }
        } catch {
          fastify.log.warn({ redirectUri }, "Invalid redirect URI format");
          // Fall through to success page
        }
      }

      return reply.type("text/html").send(renderSuccessPage(providerName, providerUser.username));
    } catch (error) {
      fastify.log.error(
        {
          err: error,
          provider: providerName,
        },
        "Provider OAuth callback error"
      );

      return reply
        .type("text/html")
        .send(
          renderErrorPage(
            "Connection Failed",
            "An error occurred while connecting. Please try again."
          )
        );
    }
  });

  /**
   * GET /integrations/connections/:id/projects
   * List projects for a connection
   */
  fastify.get(
    "/connections/:id/projects",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Get the authenticated user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      // listProviderProjects now requires userId for ownership validation
      const projects = await listProviderProjects(id, user.id);
      return sendData(reply, { projects }, { requestId: request.id });
    }
  );

  /**
   * GET /integrations/providers/:provider/all-projects
   * List projects from ALL connections for a provider
   * Used for auto-detection when user has multiple accounts/teams
   */
  fastify.get(
    "/providers/:provider/all-projects",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const { provider: providerName } = request.params as { provider: string };

      // Verify provider exists
      const provider = getProvider(providerName);
      if (!provider) {
        throw new NotFoundError(`Provider ${providerName} not found`);
      }

      // Get the authenticated user
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      const result = await listAllProviderProjects(user.id, providerName);
      return sendData(reply, result, { requestId: request.id });
    }
  );

  /**
   * POST /vaults/:owner/:repo/sync/link
   * Link a vault to a provider project without syncing
   * This saves the project selection so users can cancel and resume later
   */
  fastify.post(
    "/vaults/:owner/:repo/sync/link",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };
      const body = z
        .object({
          connectionId: z.string().uuid(),
          projectId: z.string(),
          keywayEnvironment: z.string().default("production"),
          providerEnvironment: z.string().default("production"),
        })
        .parse(request.body);

      const { vault } = await verifyVaultAccess(
        (request.vcsUser || request.githubUser!).username,
        owner,
        repo
      );

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      const link = await linkVaultToProject(
        vault.id,
        body.connectionId,
        body.projectId,
        body.keywayEnvironment,
        body.providerEnvironment,
        user.id
      );

      return sendData(reply, { link }, { requestId: request.id });
    }
  );

  /**
   * GET /vaults/:owner/:repo/sync/status
   * Get sync status for first-time detection
   */
  fastify.get(
    "/vaults/:owner/:repo/sync/status",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };
      const query = SyncStatusQuerySchema.parse(request.query);

      const { vault } = await verifyVaultAccess(
        (request.vcsUser || request.githubUser!).username,
        owner,
        repo
      );

      // Get the authenticated user for ownership validation
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
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
    }
  );

  /**
   * GET /vaults/:owner/:repo/sync/diff
   * Get bi-directional diff between Keyway vault and provider
   */
  fastify.get(
    "/vaults/:owner/:repo/sync/diff",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };
      const query = SyncDiffQuerySchema.parse(request.query);

      // Get the authenticated user first
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      const { vault, role } = await verifyVaultAccess(
        (request.vcsUser || request.githubUser!).username,
        owner,
        repo
      );

      // Check environment-level read permission for the Keyway environment, with the role
      // verifyVaultAccess checked. Diff is read-only: read permission, no cross-env check
      await requireEnvironmentPermission(vault.id, query.keywayEnvironment, user.id, role, "read");

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
    }
  );

  /**
   * GET /vaults/:owner/:repo/sync/preview
   * Preview what would change during a sync
   */
  fastify.get(
    "/vaults/:owner/:repo/sync/preview",
    {
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
    },
    async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };
      const query = SyncPreviewQuerySchema.parse(request.query);

      // Get the authenticated user first
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      const { vault, role } = await verifyVaultAccess(
        (request.vcsUser || request.githubUser!).username,
        owner,
        repo
      );

      // For Railway: append serviceId to providerEnvironment (format: "production:serviceId")
      const providerEnv = query.serviceId
        ? `${query.providerEnvironment}:${query.serviceId}`
        : query.providerEnvironment;

      // Environment-level permission and cross-environment protection, with the role
      // verifyVaultAccess checked
      await requireSyncPermission(
        vault.id,
        query.keywayEnvironment,
        providerEnv,
        query.direction,
        user.id,
        role
      );

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
    }
  );

  /**
   * POST /vaults/:owner/:repo/sync
   * Execute a sync operation
   */
  fastify.post(
    "/vaults/:owner/:repo/sync",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };
      const body = SyncBodySchema.parse(request.body);

      // Validate API key scopes based on sync direction
      // Push (Keyway → Provider) = reading secrets from Keyway
      // Pull (Provider → Keyway) = writing secrets to Keyway
      if (request.apiKey) {
        const requiredScope = body.direction === "push" ? "read:secrets" : "write:secrets";
        if (!hasRequiredScopes(request.apiKey.scopes, [requiredScope])) {
          throw new ForbiddenError(`API key missing required scope: ${requiredScope}`);
        }
      }

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, (request.vcsUser || request.githubUser!).forgeType),
          eq(users.forgeUserId, (request.vcsUser || request.githubUser!).forgeUserId)
        ),
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Verify vault access first
      const { vault, role } = await verifyVaultAccess(
        (request.vcsUser || request.githubUser!).username,
        owner,
        repo
      );

      // For Railway: append serviceId to providerEnvironment (format: "production:serviceId")
      const providerEnv = body.serviceId
        ? `${body.providerEnvironment}:${body.serviceId}`
        : body.providerEnvironment;

      // Environment-level permission and cross-environment protection, with the role
      // verifyVaultAccess checked
      await requireSyncPermission(
        vault.id,
        body.keywayEnvironment,
        providerEnv,
        body.direction,
        user.id,
        role
      );

      // Verify the connection belongs to the authenticated user
      const connection = await db.query.providerConnections.findFirst({
        where: and(
          eq(providerConnections.id, body.connectionId),
          eq(providerConnections.userId, user.id)
        ),
      });

      if (!connection) {
        throw new ForbiddenError("Connection not found or does not belong to you");
      }

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
      if (result.status === "success") {
        const { ipAddress, userAgent } = extractRequestInfo(request);
        await logActivity({
          userId: user.id,
          vaultId: vault.id,
          action: "secrets_synced",
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

      return sendData(
        reply,
        {
          success: result.status === "success",
          stats: {
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            skipped: result.skipped,
            total: result.created + result.updated + result.deleted,
          },
          error: result.error,
        },
        { requestId: request.id }
      );
    }
  );
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

// HTML template helpers: every interpolated value goes through escapeHtml
function renderErrorPage(rawTitle: string, rawMessage: string, upgradeHref?: string): string {
  const title = escapeHtml(rawTitle);
  const upgradeLink = upgradeHref
    ? ` <a href="${escapeHtml(upgradeHref)}">Upgrade your plan</a> to connect more providers.`
    : "";
  const message = `${escapeHtml(rawMessage)}${upgradeLink}`;
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
      <a href="${escapeHtml(config.app?.frontendUrl || "/")}">Return to Keyway</a>
    </div>
  </div>
</body>
</html>`;
}

function renderSuccessPage(provider: string, username: string): string {
  // Escaped once here: used in the title, the badge and the text below
  const providerName = escapeHtml(provider.charAt(0).toUpperCase() + provider.slice(1));
  // Static SVG markup from the table above, never user input
  const providerIcon = Object.hasOwn(providerIcons, provider) ? providerIcons[provider] : "";

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
      <strong>Connected as:</strong> ${escapeHtml(username)}
    </div>
    <div class="terminal-hint">
      <span class="prompt">$</span> <span class="command">keyway sync ${escapeHtml(provider)}</span>
    </div>
  </div>
</body>
</html>`;
}
