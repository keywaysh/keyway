import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { z } from "zod";
import { db, users, deviceCodes } from "../../../db";
import { eq, and, gt } from "drizzle-orm";
import { exchangeCodeForToken, getUserFromToken } from "../../../utils/github";
import { trackEvent, AnalyticsEvents, getSignupSource } from "../../../utils/analytics";
import {
  generateDeviceCode,
  generateUserCode,
  DEVICE_FLOW_CONFIG,
} from "../../../utils/deviceCodes";
import { generateKeywayToken, getTokenExpiresAt } from "../../../utils/jwt";
import { config } from "../../../config";
import { NotFoundError, BadRequestError } from "../../../lib";
import { authenticateGitHub } from "../../../middleware/auth";
import { encryptAccessToken } from "../../../utils/tokenEncryption";
import {
  signState,
  verifyState,
  createStateNonce,
  stateNonceMatches,
  STATE_NONCE_MAX_AGE_SECONDS,
} from "../../../utils/state";
import { handleNewUserSignup } from "../../../services/signup.service";
import { sendData, sendNoContent } from "../../../lib/response";
import {
  handleInstallationCreated,
  checkInstallationStatus,
} from "../../../services/github-app.service";
import { logActivity, extractRequestInfo, detectPlatform } from "../../../services";
import { escapeHtml } from "../../../utils/html";

// Schemas
const DeviceFlowStartSchema = z.object({
  repository: z.string().optional(),
  ownerId: z.number().optional(),
  repoId: z.number().optional(),
});

const DeviceFlowPollSchema = z.object({
  deviceCode: z.string().min(1),
});

// User codes look like XXXXX-XXXXX; anything else is refused before it reaches HTML or the DB
const USER_CODE_PATTERN = /^[A-Z0-9-]{1,16}$/;

function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const code = raw.trim().toUpperCase();
  return USER_CODE_PATTERN.test(code) ? code : null;
}

// Nonce cookie binding the OAuth state to the browser (see utils/state.ts)
const OAUTH_NONCE_COOKIE = "keyway_oauth_nonce";
const OAUTH_CALLBACK_PATH = "/v1/auth/callback";

function oauthNonceCookieOptions() {
  return {
    path: OAUTH_CALLBACK_PATH,
    httpOnly: true,
    secure: config.server.isProduction,
    sameSite: "lax" as const,
  };
}

/** Puts a fresh nonce in the browser and returns the hash to sign into the state. */
function bindStateToBrowser(reply: FastifyReply): string {
  const { nonce, nonceHash } = createStateNonce();
  reply.setCookie(OAUTH_NONCE_COOKIE, nonce, {
    ...oauthNonceCookieOptions(),
    maxAge: STATE_NONCE_MAX_AGE_SECONDS,
  });
  return nonceHash;
}

function clearOAuthNonceCookie(reply: FastifyReply) {
  reply.clearCookie(OAUTH_NONCE_COOKIE, oauthNonceCookieOptions());
}

/**
 * A browser form posted from another site (CSRF).
 *
 * Sec-Fetch-Site, set by the browser itself, decides when present: only the verify page
 * (same-origin) or a user-initiated navigation (none). Origin is no help there: under
 * helmet's `Referrer-Policy: no-referrer` a form POST carries `Origin: null` even from the
 * page itself (Fetch spec, "append a request Origin header").
 * Without Sec-Fetch-Site, a real Origin must name this host and `Origin: null` is refused;
 * the verify page is served with `Referrer-Policy: same-origin` so those browsers send it.
 * A request with neither header is not a browser form post.
 */
function isCrossSiteRequest(request: FastifyRequest): boolean {
  const fetchSite = request.headers["sec-fetch-site"];
  if (typeof fetchSite === "string") {
    return fetchSite !== "same-origin" && fetchSite !== "none";
  }
  const origin = request.headers.origin;
  if (typeof origin === "string") {
    const host = request.headers.host;
    if (origin === "null" || !host) {
      return true;
    }
    try {
      const originUrl = new URL(origin);
      return originUrl.host !== new URL(`${originUrl.protocol}//${host}`).host;
    } catch {
      return true;
    }
  }
  return false;
}

const ALREADY_USED_MESSAGE =
  "This verification code has already been used or has expired. Run keyway login again to get a new one.";

/**
 * Marks a device code consumed so that it gives tokens to one poll only.
 * Conditional on its current status: of two concurrent polls, one wins.
 */
async function consumeDeviceCode(
  deviceCodeId: string,
  fromStatus: "approved" | "oauth_complete"
): Promise<boolean> {
  const consumed = await db
    .update(deviceCodes)
    .set({ status: "expired" })
    .where(and(eq(deviceCodes.id, deviceCodeId), eq(deviceCodes.status, fromStatus)))
    .returning({ id: deviceCodes.id });
  return consumed.length > 0;
}

// The web login, which binds its state to the browser (relative: same API host)
const WEB_LOGIN_PATH = "/v1/auth/github/start";

/**
 * The only paths on this API a web sign-in may return to (relative redirect_uri of
 * /github/start): a provider authorization opened with a ticket in a browser without a
 * Keyway session (integrations.routes.ts). Strict so it never becomes an open redirect.
 */
const SIGN_IN_RETURN_PATH =
  /^\/v1\/integrations\/[a-z0-9-]{1,32}\/authorize\?ticket=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+&after_login=1$/;

/**
 * Whether the GitHub user of `accessToken` can access a Keyway App installation:
 * GET /user/installations lists the installations of this App the user can access.
 */
async function userCanAccessInstallation(
  accessToken: string,
  installationId: number
): Promise<boolean> {
  const perPage = 100;
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `${config.github.apiBaseUrl}/user/installations?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!response.ok) {
      return false;
    }
    const data = (await response.json()) as { installations?: Array<{ id?: unknown }> };
    const installations = Array.isArray(data.installations) ? data.installations : [];
    if (installations.some((installation) => installation.id === installationId)) {
      return true;
    }
    if (installations.length < perPage) {
      return false;
    }
  }
  return false;
}

// Helper to build the unified callback URL
function buildCallbackUrl(request: {
  headers: { "x-forwarded-proto"?: string; host?: string };
  hostname: string;
}): string {
  const protocol =
    request.headers["x-forwarded-proto"] || (config.server.isDevelopment ? "http" : "https");
  const host = request.headers.host || request.hostname;
  return `${protocol}://${host}/v1/auth/callback`;
}

// Helper to create or update user from VCS data
async function upsertUser(
  vcsUser: {
    forgeUserId: string;
    username: string;
    email: string | null;
    avatarUrl: string | null;
  },
  accessToken: string,
  forgeType: "github" | "gitlab" | "bitbucket" = "github"
) {
  const encryptedToken = await encryptAccessToken(accessToken);

  // Check if user exists first (to determine isNewUser)
  const existingUser = await db.query.users.findFirst({
    where: and(eq(users.forgeType, forgeType), eq(users.forgeUserId, vcsUser.forgeUserId)),
    columns: { id: true },
  });

  // Use atomic upsert with ON CONFLICT to prevent race conditions
  // This ensures we never create duplicate users for the same forgeType + forgeUserId
  const [user] = await db
    .insert(users)
    .values({
      forgeType,
      forgeUserId: vcsUser.forgeUserId,
      username: vcsUser.username,
      email: vcsUser.email,
      avatarUrl: vcsUser.avatarUrl,
      ...encryptedToken,
    })
    .onConflictDoUpdate({
      target: [users.forgeType, users.forgeUserId],
      set: {
        username: vcsUser.username,
        email: vcsUser.email,
        avatarUrl: vcsUser.avatarUrl,
        ...encryptedToken,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { user, isNewUser: !existingUser };
}

// Helper to set session cookies
function setSessionCookies(
  reply: { setCookie: (name: string, value: string, options: Record<string, unknown>) => void },
  request: { headers: { host?: string } },
  keywayToken: string
) {
  const isProduction = config.server.isProduction;
  const maxAge = 30 * 24 * 60 * 60; // 30 days

  const host = (request.headers.host || "").split(":")[0];
  const isLocalDev =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local");
  let domain: string | undefined;

  if (isLocalDev) {
    // For local development, set domain to share cookies across subdomains
    // e.g., keyway.local, app.keyway.local, api.keyway.local
    if (host.endsWith(".local")) {
      // Extract base domain (e.g., keyway.local from api.keyway.local)
      const parts = host.split(".");
      domain = parts.slice(-2).join(".");
    } else {
      domain = "localhost";
    }
  } else if (isProduction) {
    // In production, set domain to parent domain (e.g., .keyway.sh)
    const parts = host.split(".");
    if (parts.length >= 2) {
      domain = `.${parts.slice(-2).join(".")}`;
    }
  }

  reply.setCookie("keyway_session", keywayToken, {
    path: "/",
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge,
    domain,
  });

  reply.setCookie("keyway_logged_in", "true", {
    path: "/",
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax",
    maxAge,
    domain,
  });
}

/**
 * Auth routes
 * GET  /v1/auth/github/start     - Start web OAuth flow
 * GET  /v1/auth/callback         - OAuth callback
 * POST /v1/auth/device/start     - Start device flow
 * POST /v1/auth/device/poll      - Poll device flow
 * GET  /v1/auth/device/verify    - Device verification page
 * POST /v1/auth/device/verify    - Submit device verification
 * POST /v1/auth/token/validate   - Validate token
 */
export async function authRoutes(fastify: FastifyInstance) {
  // The OAuth flows need cookies (session + state nonce); index.ts registers the plugin globally
  if (!fastify.hasReplyDecorator("setCookie")) {
    await fastify.register(cookie);
  }

  /**
   * GET /callback
   * Unified GitHub OAuth callback for both web and device flows
   * Also handles GitHub App installation callbacks (setup_action=install)
   */
  fastify.get("/callback", async (request, reply) => {
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      installation_id?: string;
      setup_action?: string;
    };

    if (query.error) {
      fastify.log.warn({ error: query.error }, "GitHub OAuth error");
      return reply
        .type("text/html")
        .send(
          renderErrorPage(
            "Authorization Denied",
            "You denied the authorization request. You can close this window."
          )
        );
    }

    // GitHub App installation callback: setup_action 'install' (new installation) or
    // 'update' (permission update), with installation_id. Reached after a direct install
    // from GitHub (no state) or from the chained CLI flow (install state bound to this
    // browser). Never opens a browser session: anyone can send someone this URL with their
    // own unused code and installation id (login CSRF).
    if (
      (query.setup_action === "install" || query.setup_action === "update") &&
      query.installation_id
    ) {
      fastify.log.info(
        { installationId: query.installation_id, setupAction: query.setup_action },
        "GitHub App installation callback"
      );

      // No code - just installation ID, show success page (origin unknown, assume web)
      if (!query.code) {
        return reply.type("text/html").send(renderInstallSuccessPage(query.installation_id, false));
      }

      // The nonce is single-use whatever the outcome
      const browserNonce = request.cookies?.[OAUTH_NONCE_COOKIE];
      clearOAuthNonceCookie(reply);

      const installationId = Number(query.installation_id);
      if (!/^\d{1,16}$/.test(query.installation_id) || !Number.isSafeInteger(installationId)) {
        return reply
          .status(400)
          .type("text/html")
          .send(renderErrorPage("Installation Error", "Invalid installation id."));
      }

      // Chained CLI flow only: the install state minted by the device branch below, coming
      // back to the browser that did the OAuth step
      const stateData = query.state ? verifyState(query.state) : null;
      const chainedDeviceCodeId =
        stateData?.type === "github_app_install" &&
        typeof stateData.deviceCodeId === "string" &&
        stateNonceMatches(stateData, browserNonce)
          ? stateData.deviceCodeId
          : null;
      if (query.state && !chainedDeviceCodeId) {
        fastify.log.warn(
          { installationId },
          "GitHub App install callback with a state not bound to this browser; ignoring the state"
        );
      }

      try {
        const accessToken = await exchangeCodeForToken(query.code);
        const githubUser = await getUserFromToken(accessToken);
        const { user, isNewUser } = await upsertUser(githubUser, accessToken);

        // Recorded for the user of the code only if GitHub says that user can see it
        if (await userCanAccessInstallation(accessToken, installationId)) {
          await handleInstallationCreated(installationId, user.id);
        } else {
          fastify.log.warn(
            { installationId, userId: user.id },
            "GitHub App installation not visible to the user of the code; not recording it"
          );
        }

        if (isNewUser) {
          await handleNewUserSignup({
            user,
            signupSource: "github_app_install",
            method: "github_app_install",
          });
        }

        if (chainedDeviceCodeId) {
          // The OAuth step set the device code's user and left it oauth_complete: approve it.
          // A pending code is never approved here.
          const deviceCodeRecord = await db.query.deviceCodes.findFirst({
            where: eq(deviceCodes.id, chainedDeviceCodeId),
          });
          let approved = false;
          if (deviceCodeRecord?.status === "oauth_complete") {
            const rows = await db
              .update(deviceCodes)
              .set({ status: "approved" })
              .where(
                and(
                  eq(deviceCodes.id, chainedDeviceCodeId),
                  eq(deviceCodes.status, "oauth_complete"),
                  gt(deviceCodes.expiresAt, new Date())
                )
              )
              .returning({ id: deviceCodes.id });
            approved = rows.length > 0;
          }

          if (approved) {
            fastify.log.info(
              { deviceCodeId: chainedDeviceCodeId, userId: deviceCodeRecord?.userId },
              "Device code approved after GitHub App installation (chained flow)"
            );
            const { ipAddress, userAgent } = extractRequestInfo(request);
            await logActivity({
              userId: user.id,
              action: "user_login",
              platform: "cli",
              ipAddress,
              userAgent,
              metadata: { method: "github_app_install", isNewUser, installationId },
            });
            trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
              username: githubUser.username,
              method: "github_app_install",
              isNewUser,
              installationId,
            });
            return reply
              .type("text/html")
              .send(renderInstallSuccessPage(query.installation_id, true));
          }

          // The CLI poll saw the installation first and already took its token
          if (deviceCodeRecord?.status === "expired" && deviceCodeRecord.userId === user.id) {
            return reply
              .type("text/html")
              .send(renderInstallSuccessPage(query.installation_id, true));
          }

          fastify.log.warn(
            { deviceCodeId: chainedDeviceCodeId, status: deviceCodeRecord?.status },
            "GitHub App install state for a device code not waiting for installation; not approving"
          );
          return reply
            .type("text/html")
            .send(renderErrorPage("Code Already Used", ALREADY_USED_MESSAGE));
        }

        // Direct install (or a state that is not this browser's): no session from here,
        // the browser signs in through the normal web login, bound to it by its nonce
        return reply.redirect(WEB_LOGIN_PATH);
      } catch (error) {
        fastify.log.error(
          { err: error, installationId: query.installation_id },
          "GitHub App installation error"
        );
        return reply
          .type("text/html")
          .send(
            renderErrorPage(
              "Installation Error",
              "An error occurred while processing the GitHub App installation. Please try again."
            )
          );
      }
    }

    if (!query.code || !query.state) {
      throw new BadRequestError("Missing code or state parameter");
    }

    // The nonce is single-use whatever the outcome
    const browserNonce = request.cookies?.[OAUTH_NONCE_COOKIE];
    clearOAuthNonceCookie(reply);

    try {
      // Verify signed state to prevent CSRF attacks (CRIT-2 fix)
      const stateData = verifyState(query.state);
      if (!stateData) {
        throw new BadRequestError("Invalid or tampered state parameter");
      }
      // Only states minted for this branch: a github_app_install state (handed out by
      // /device/start) must not approve a device code here
      if (stateData.type !== "web" && stateData.type !== "device") {
        throw new BadRequestError("Invalid state parameter");
      }
      // The state must come back to the browser that started the flow
      if (!stateNonceMatches(stateData, browserNonce)) {
        throw new BadRequestError("OAuth state was not started in this browser");
      }

      let pendingRecord: Awaited<ReturnType<typeof db.query.deviceCodes.findFirst>> = undefined;
      if (stateData.type === "device") {
        if (typeof stateData.deviceCodeId !== "string") {
          throw new BadRequestError("Invalid state parameter");
        }
        pendingRecord = await db.query.deviceCodes.findFirst({
          where: eq(deviceCodes.id, stateData.deviceCodeId),
        });
        if (
          !pendingRecord ||
          pendingRecord.status !== "pending" ||
          new Date() > pendingRecord.expiresAt
        ) {
          return reply
            .type("text/html")
            .send(renderErrorPage("Code Already Used", ALREADY_USED_MESSAGE));
        }
      }

      const accessToken = await exchangeCodeForToken(query.code);
      const githubUser = await getUserFromToken(accessToken);
      const { user, isNewUser } = await upsertUser(githubUser, accessToken);

      if (stateData.type === "web") {
        const keywayToken = generateKeywayToken({
          userId: user.id,
          forgeType: user.forgeType,
          forgeUserId: user.forgeUserId,
          username: user.username,
        });

        const signupSource = isNewUser ? getSignupSource(request.headers.referer) : undefined;

        // Log user login activity
        const { ipAddress, userAgent } = extractRequestInfo(request);
        await logActivity({
          userId: user.id,
          action: "user_login",
          platform: detectPlatform(userAgent),
          ipAddress,
          userAgent,
          metadata: {
            method: "web_oauth",
            isNewUser,
          },
        });

        trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
          username: githubUser.username,
          method: "web_oauth",
          isNewUser,
          signupSource,
        });

        if (isNewUser) {
          await handleNewUserSignup({
            user,
            signupSource: signupSource || "web",
            method: "web_oauth",
          });
        }

        setSessionCookies(reply, request, keywayToken);

        const redirectUrl = (stateData.redirectUri as string | null) || config.app.dashboardUrl;
        return reply.redirect(redirectUrl);
      } else if (pendingRecord) {
        const deviceCodeRecord = pendingRecord;
        const deviceCodeId = deviceCodeRecord.id;
        // Only a code still pending and not expired, decided by the UPDATE itself
        const stillPending = and(
          eq(deviceCodes.id, deviceCodeId),
          eq(deviceCodes.status, "pending"),
          gt(deviceCodes.expiresAt, new Date())
        );

        // Check if we should chain to GitHub App installation
        if (deviceCodeRecord.suggestedRepository) {
          const [owner, repo] = deviceCodeRecord.suggestedRepository.split("/");

          if (owner && repo) {
            try {
              const installStatus = await checkInstallationStatus(owner, repo);

              if (!installStatus.installed) {
                // DON'T approve yet - mark as oauth_complete and redirect to app install
                const marked = await db
                  .update(deviceCodes)
                  .set({ status: "oauth_complete", userId: user.id })
                  .where(stillPending)
                  .returning({ id: deviceCodes.id });
                if (marked.length === 0) {
                  return reply
                    .type("text/html")
                    .send(renderErrorPage("Code Already Used", ALREADY_USED_MESSAGE));
                }

                // Build GitHub App install URL with state. Bound to this browser by a fresh
                // nonce (this response replaces the one cleared above): back at this
                // callback, only this browser can approve the device code
                const appInstallState = signState({
                  deviceCodeId,
                  type: "github_app_install",
                  nonceHash: bindStateToBrowser(reply),
                });

                // Deep linking if we have the IDs (stored by /device/start)
                let appInstallUrl: string;
                if (deviceCodeRecord.suggestedOwnerId && deviceCodeRecord.suggestedRepoId) {
                  appInstallUrl =
                    `${config.githubApp.installUrl}/permissions?` +
                    `suggested_target_id=${deviceCodeRecord.suggestedOwnerId}&` +
                    `repository_ids[]=${deviceCodeRecord.suggestedRepoId}&` +
                    `state=${encodeURIComponent(appInstallState)}`;
                } else {
                  appInstallUrl = `${config.githubApp.installUrl}?state=${encodeURIComponent(appInstallState)}`;
                }

                fastify.log.info(
                  {
                    deviceCodeId,
                    userId: user.id,
                    suggestedRepository: deviceCodeRecord.suggestedRepository,
                  },
                  "OAuth complete, chaining to GitHub App installation"
                );

                // Handle new user signup before redirect (chained flow)
                if (isNewUser) {
                  await handleNewUserSignup({
                    user,
                    signupSource: "cli",
                    method: "device_flow_chained",
                  });
                }

                return reply.redirect(appInstallUrl);
              }
            } catch (err) {
              // If check fails, continue normally (fallback to approve immediately)
              fastify.log.warn(
                { error: err },
                "Failed to check GitHub App installation, continuing with approval"
              );
            }
          }
        }

        // App already installed OR no suggestedRepository OR error -> approve now
        const approved = await db
          .update(deviceCodes)
          .set({
            status: "approved",
            userId: user.id,
          })
          .where(stillPending)
          .returning({ id: deviceCodes.id });
        if (approved.length === 0) {
          return reply
            .type("text/html")
            .send(renderErrorPage("Code Already Used", ALREADY_USED_MESSAGE));
        }

        // Log user login activity (CLI device flow)
        const { ipAddress, userAgent } = extractRequestInfo(request);
        await logActivity({
          userId: user.id,
          action: "user_login",
          platform: "cli",
          ipAddress,
          userAgent,
          metadata: {
            method: "device_flow",
            isNewUser,
          },
        });

        trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
          username: githubUser.username,
          method: "device_flow",
          isNewUser,
        });

        if (isNewUser) {
          await handleNewUserSignup({
            user,
            signupSource: "cli",
            method: "device_flow",
          });
        }

        return reply.type("text/html").send(renderSuccessPage(user.username));
      } else {
        throw new BadRequestError("Invalid state parameter");
      }
    } catch (error) {
      fastify.log.error(
        {
          err: error,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "OAuth callback error"
      );
      trackEvent("anonymous", AnalyticsEvents.AUTH_FAILURE, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return reply
        .type("text/html")
        .send(
          renderErrorPage(
            "Authentication Error",
            "An error occurred during authentication. Please try again."
          )
        );
    }
  });

  /**
   * GET /github/start
   * Start the web OAuth flow
   */
  fastify.get("/github/start", async (request, reply) => {
    const query = request.query as { redirect_uri?: string };
    const redirectUri = query.redirect_uri;

    if (redirectUri) {
      let isAllowed: boolean;
      if (redirectUri.startsWith("/")) {
        // A path on this API: only the sign-in round trip of a provider authorization
        isAllowed = SIGN_IN_RETURN_PATH.test(redirectUri);
      } else if (config.cors.allowAll) {
        isAllowed = true;
      } else {
        try {
          const redirectUrl = new URL(redirectUri);
          const redirectOrigin = redirectUrl.origin;
          isAllowed = config.cors.allowedOrigins.some((origin) => {
            try {
              const allowedUrl = new URL(origin);
              return redirectOrigin === allowedUrl.origin;
            } catch {
              return redirectOrigin === origin;
            }
          });
        } catch {
          isAllowed = false;
        }
      }

      if (!isAllowed) {
        fastify.log.warn({ redirectUri }, "Blocked redirect to non-allowed origin");
        throw new BadRequestError("The redirect_uri is not in the allowed origins list");
      }
    }

    // Sign state with HMAC to prevent CSRF attacks (CRIT-2 fix), bound to this browser
    const state = signState({
      type: "web",
      redirectUri: redirectUri || null,
      nonceHash: bindStateToBrowser(reply),
    });

    const callbackUri = buildCallbackUrl(request);

    const githubAuthUrl = new URL(`${config.github.url}/login/oauth/authorize`);
    githubAuthUrl.searchParams.set("client_id", config.github.clientId);
    githubAuthUrl.searchParams.set("redirect_uri", callbackUri);
    githubAuthUrl.searchParams.set("scope", "read:user user:email read:org");
    githubAuthUrl.searchParams.set("state", state);

    return reply.redirect(githubAuthUrl.toString());
  });

  /**
   * POST /device/start
   * Start the device authorization flow
   */
  fastify.post("/device/start", async (request, _reply) => {
    const body = DeviceFlowStartSchema.parse(request.body);

    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + DEVICE_FLOW_CONFIG.EXPIRES_IN * 1000);

    await db.insert(deviceCodes).values({
      deviceCode,
      userCode,
      status: "pending",
      suggestedRepository: body.repository,
      suggestedOwnerId: body.ownerId, // For deep linking in chained OAuth flow
      suggestedRepoId: body.repoId, // For deep linking in chained OAuth flow
      expiresAt,
    });

    const protocol =
      request.headers["x-forwarded-proto"] || (config.server.isDevelopment ? "http" : "https");
    const verificationUri = `${protocol}://${request.hostname}/v1/auth/device/verify`;
    const verificationUriComplete = `${verificationUri}?user_code=${userCode}`;

    // No GitHub App install URL here: the install callback only honours an install state
    // bound to the browser that did the OAuth step, minted by /callback when it chains to
    // the installation (the deep-link IDs stored above are used there)
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn: DEVICE_FLOW_CONFIG.EXPIRES_IN,
      interval: DEVICE_FLOW_CONFIG.POLL_INTERVAL,
    };
  });

  /**
   * POST /device/poll
   * Poll for device authorization status
   */
  fastify.post("/device/poll", async (request, reply) => {
    const body = DeviceFlowPollSchema.parse(request.body);

    const deviceCodeRecord = await db.query.deviceCodes.findFirst({
      where: eq(deviceCodes.deviceCode, body.deviceCode),
      with: { user: true },
    });

    if (!deviceCodeRecord) {
      throw new NotFoundError("Invalid device code");
    }

    if (new Date() > deviceCodeRecord.expiresAt) {
      await db
        .update(deviceCodes)
        .set({ status: "expired" })
        .where(eq(deviceCodes.deviceCode, body.deviceCode));

      // Note: Device flow responses intentionally include 'status' for CLI compatibility
      return reply.status(400).send({
        status: "expired",
        error: "device_code_expired",
        message: "The device code has expired. Please restart the authentication flow.",
      });
    }

    if (deviceCodeRecord.status === "pending") {
      return { status: "pending" };
    }

    if (deviceCodeRecord.status === "oauth_complete") {
      // OAuth done, waiting for GitHub App installation
      // Check if installation is now available (handles case where GitHub doesn't redirect back)
      if (deviceCodeRecord.suggestedRepository && deviceCodeRecord.userId) {
        const [owner, repo] = deviceCodeRecord.suggestedRepository.split("/");
        if (owner && repo) {
          try {
            const installStatus = await checkInstallationStatus(owner, repo);
            if (installStatus.installed) {
              // Load user and return token
              const user = await db.query.users.findFirst({
                where: eq(users.id, deviceCodeRecord.userId),
              });

              if (user) {
                // Installation now available: hand out the token once (the code is consumed)
                if (!(await consumeDeviceCode(deviceCodeRecord.id, "oauth_complete"))) {
                  // The code left "oauth_complete" since we read it: the install
                  // callback approved it (next poll takes the "approved" branch) or
                  // another poll consumed it (next poll sees "expired"). Either way
                  // single use holds; keep polling rather than abort the login.
                  return { status: "pending" };
                }

                fastify.log.info(
                  {
                    deviceCodeId: deviceCodeRecord.id,
                    userId: user.id,
                    repository: deviceCodeRecord.suggestedRepository,
                  },
                  "Device code approved after detecting GitHub App installation via poll"
                );

                const keywayToken = generateKeywayToken({
                  userId: user.id,
                  forgeType: user.forgeType,
                  forgeUserId: user.forgeUserId,
                  username: user.username,
                });

                const expiresAt = getTokenExpiresAt(keywayToken);

                return {
                  status: "approved",
                  keywayToken,
                  githubLogin: user.username,
                  expiresAt: expiresAt.toISOString(),
                };
              }
            }
          } catch (err) {
            fastify.log.warn({ error: err }, "Failed to check installation status during poll");
          }
        }
      }
      // Installation not yet available, keep polling
      return { status: "pending" };
    }

    if (deviceCodeRecord.status === "denied") {
      // Note: Device flow responses intentionally include 'status' for CLI compatibility
      return reply.status(403).send({
        status: "denied",
        error: "authorization_denied",
        message: "User denied the authorization request.",
      });
    }

    if (deviceCodeRecord.status === "expired") {
      // Note: Device flow responses intentionally include 'status' for CLI compatibility
      return reply.status(400).send({
        status: "expired",
        error: "device_code_expired",
        message: "The device code has expired.",
      });
    }

    if (deviceCodeRecord.status === "approved") {
      if (!deviceCodeRecord.user) {
        fastify.log.error(
          {
            deviceCodeId: deviceCodeRecord.id,
            userId: deviceCodeRecord.userId,
            status: deviceCodeRecord.status,
          },
          "Device code approved but user not loaded"
        );
        throw new Error("User not found for approved device code");
      }

      // Single use: once a poll got the token, later polls get "expired"
      if (!(await consumeDeviceCode(deviceCodeRecord.id, "approved"))) {
        return reply.status(400).send({
          status: "expired",
          error: "device_code_expired",
          message: "The device code has already been used.",
        });
      }

      const keywayToken = generateKeywayToken({
        userId: deviceCodeRecord.user.id,
        forgeType: deviceCodeRecord.user.forgeType,
        forgeUserId: deviceCodeRecord.user.forgeUserId,
        username: deviceCodeRecord.user.username,
      });

      const expiresAt = getTokenExpiresAt(keywayToken);

      return {
        status: "approved",
        keywayToken,
        githubLogin: deviceCodeRecord.user.username,
        expiresAt: expiresAt.toISOString(),
      };
    }

    return { status: "pending" };
  });

  /**
   * GET /device/verify
   * Device verification page
   */
  fastify.get("/device/verify", async (request, reply) => {
    const rawCode = (request.query as { user_code?: unknown }).user_code;
    let userCode = "";
    if (rawCode !== undefined && rawCode !== "") {
      const normalized = normalizeUserCode(rawCode);
      if (!normalized) {
        return reply
          .status(400)
          .type("text/html")
          .send(renderErrorPage("Invalid Code", "This link does not contain a valid code."));
      }
      userCode = normalized;
    }
    const autoSubmit = userCode.length === 11; // XXXXX-XXXXX = 11 chars

    // Track funnel: page view
    trackEvent("anonymous", AnalyticsEvents.DEVICE_VERIFY_PAGE_VIEW, {
      hasCode: autoSubmit,
    });

    // Instead of helmet's no-referrer: the form POST to this same origin then carries the
    // real Origin, which isCrossSiteRequest needs from browsers without Sec-Fetch-Site
    reply.header("Referrer-Policy", "same-origin");
    reply.type("text/html").send(renderVerifyPage(userCode, autoSubmit));
  });

  /**
   * POST /device/verify
   * Submit device verification
   * Rate limited to 5 requests per minute to prevent brute force (CRIT-3 fix)
   *
   * The only route that takes an HTML form body: the urlencoded parser is registered in
   * this scope only, every other route answers 415 to a form.
   */
  fastify.register(async (formScope) => {
    if (!formScope.hasContentTypeParser("application/x-www-form-urlencoded")) {
      await formScope.register(formbody, { bodyLimit: 1024 });
    }

    formScope.post(
      "/device/verify",
      {
        config: {
          rateLimit: {
            max: 5,
            timeWindow: "1 minute",
          },
        },
      },
      async (request, reply) => {
        // A form auto-submitted by another site would start the flow in the victim's browser
        if (isCrossSiteRequest(request)) {
          return reply
            .status(403)
            .type("text/html")
            .send(
              renderErrorPage(
                "Request Blocked",
                "Submit the code from the Keyway verification page."
              )
            );
        }

        const userCode = normalizeUserCode(
          (request.body as { user_code?: unknown } | undefined)?.user_code
        );
        if (!userCode) {
          return reply
            .status(400)
            .type("text/html")
            .send(
              renderErrorPage(
                "Invalid Code",
                "Enter the code displayed in your terminal (format XXXXX-XXXXX)."
              )
            );
        }

        // Track funnel: form submitted
        trackEvent("anonymous", AnalyticsEvents.DEVICE_VERIFY_SUBMIT, {
          codeLength: userCode.length,
        });

        const deviceCodeRecord = await db.query.deviceCodes.findFirst({
          where: eq(deviceCodes.userCode, userCode),
        });

        if (!deviceCodeRecord) {
          return reply
            .type("text/html")
            .send(
              renderErrorPage("Invalid Code", "The code you entered is invalid or has expired.")
            );
        }

        if (new Date() > deviceCodeRecord.expiresAt) {
          return reply
            .type("text/html")
            .send(
              renderErrorPage(
                "Code Expired",
                "This verification code has expired. Please restart the authentication flow."
              )
            );
        }

        if (deviceCodeRecord.status !== "pending") {
          return reply
            .type("text/html")
            .send(renderErrorPage("Code Already Used", ALREADY_USED_MESSAGE));
        }

        // Signed (CRIT-2 fix) and bound to this browser by the nonce cookie
        const state = signState({
          type: "device",
          deviceCodeId: deviceCodeRecord.id,
          nonceHash: bindStateToBrowser(reply),
        });
        const callbackUri = buildCallbackUrl(request);

        const githubAuthUrl = new URL(`${config.github.url}/login/oauth/authorize`);
        githubAuthUrl.searchParams.set("client_id", config.github.clientId);
        githubAuthUrl.searchParams.set("redirect_uri", callbackUri);
        githubAuthUrl.searchParams.set("scope", "read:user user:email read:org");
        githubAuthUrl.searchParams.set("state", state);

        return reply.redirect(githubAuthUrl.toString());
      }
    );
  });

  /**
   * POST /token/validate
   * Validate a token
   */
  fastify.post(
    "/token/validate",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const vcsUser = request.vcsUser || request.githubUser;

      // Fetch user from DB to get plan
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser!.forgeType),
          eq(users.forgeUserId, vcsUser!.forgeUserId)
        ),
        columns: {
          plan: true,
          createdAt: true,
        },
      });

      return sendData(
        reply,
        {
          username: vcsUser!.username,
          forgeType: vcsUser!.forgeType,
          forgeUserId: vcsUser!.forgeUserId,
          plan: user?.plan || "free",
          createdAt: user?.createdAt?.toISOString() || null,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /logout
   * Clear session cookie
   */
  fastify.post("/logout", async (request, reply) => {
    const isProduction = config.server.isProduction;

    // Determine domain for cookie
    const host = (request.headers.host || "").split(":")[0];
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
    let domain: string | undefined;

    if (isProduction && !isLocalhost) {
      const parts = host.split(".");
      if (parts.length >= 2) {
        domain = `.${parts.slice(-2).join(".")}`;
      }
    }

    // Clear session cookie with same security flags
    reply.clearCookie("keyway_session", {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      domain,
    });

    // Clear flag cookie
    reply.clearCookie("keyway_logged_in", {
      path: "/",
      httpOnly: false,
      secure: isProduction,
      sameSite: "lax",
      domain,
    });

    return sendNoContent(reply);
  });
}

// Keyway logo SVG
const keywayLogoSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="logo-icon">
  <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor"/>
  <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// HTML template helpers: every interpolated value goes through escapeHtml
function renderErrorPage(rawTitle: string, rawMessage: string): string {
  const title = escapeHtml(rawTitle);
  const message = escapeHtml(rawMessage);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - ${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
      <a href="${escapeHtml(config.app.frontendUrl)}">Return to Keyway</a>
    </div>
  </div>
</body>
</html>`;
}

function renderSuccessPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - Success</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
      Logged in successfully
    </div>
    <h1>You're all set!</h1>
    <p>You can now close this window and return to your terminal.</p>
    <div class="user-info">
      <strong>Logged in as:</strong> ${escapeHtml(username)}
    </div>
  </div>
</body>
</html>`;
}

function renderVerifyPage(userCode: string, autoSubmit: boolean): string {
  // For autoSubmit, we redirect server-side immediately instead of using JS
  // This avoids CSP issues with inline scripts
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - Device Verification</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      color: #6b7280;
      line-height: 1.6;
      font-size: 15px;
      text-align: center;
      margin-bottom: 24px;
    }
    .code-confirmed {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #ecfdf5;
      color: #059669;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
      font-weight: 500;
    }
    .code-confirmed svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .permissions {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .permissions-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 16px;
    }
    .permissions-header svg {
      width: 18px;
      height: 18px;
      color: #6b7280;
    }
    .permissions ul {
      list-style: none;
    }
    .permissions li {
      padding: 8px 0;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 14px;
      color: #374151;
    }
    .permissions li svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .check { color: #10b981; }
    .cross { color: #ef4444; }
    .permissions-note {
      font-size: 12px;
      color: #6b7280;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    input {
      padding: 14px 16px;
      font-size: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 3px;
      text-align: center;
      font-weight: 600;
      color: #111827;
      background: #f9fafb;
      transition: all 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #10b981;
      background: white;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
    }
    input::placeholder {
      color: #9ca3af;
      letter-spacing: 3px;
    }
    button {
      background: #111827;
      color: white;
      padding: 14px 24px;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button:hover {
      background: #1f2937;
    }
    button svg {
      width: 20px;
      height: 20px;
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      color: #92400e;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 14px;
      line-height: 1.5;
    }
    .warning code {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      ${keywayLogoSvg}
      <span>Keyway</span>
    </div>
    <h1>Verify Your Device</h1>
    <p class="warning" role="alert">
      <strong>Only continue if you started <code>keyway login</code> yourself and the code matches your terminal.</strong>
      Continuing signs that terminal in to Keyway as you.
    </p>
    ${
      autoSubmit
        ? `<p class="subtitle">Code detected! Click below to continue.</p>
         <div class="code-confirmed">
           <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
             <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
           </svg>
           Code <strong>${escapeHtml(userCode)}</strong> confirmed
         </div>`
        : '<p class="subtitle">Enter the code displayed in your terminal to continue with GitHub authentication.</p>'
    }
    <div class="permissions">
      <div class="permissions-header">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
        </svg>
        What Keyway will access
      </div>
      <ul>
        <li>
          <svg class="check" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          Your GitHub username and email (for authentication)
        </li>
        <li>
          <svg class="cross" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
          NEVER reads your repository code
        </li>
        <li>
          <svg class="cross" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
          NEVER reads issues or pull requests
        </li>
      </ul>
      <p class="permissions-note">Repository access requires installing the Keyway GitHub App (separate step)</p>
    </div>
    <form id="verifyForm" action="/v1/auth/device/verify" method="POST">
      <input type="text" name="user_code" id="userCodeInput" placeholder="XXXXX-XXXXX" value="${escapeHtml(userCode)}" pattern="[A-Z0-9]{5}-[A-Z0-9]{5}" maxlength="11" required ${autoSubmit ? "readonly" : "autofocus"} />
      <button type="submit">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
        Continue with GitHub
      </button>
    </form>
  </div>
</body>
</html>`;
}

function renderInstallSuccessPage(installationId: string, isFromCli = false): string {
  const actionHtml = isFromCli
    ? ""
    : `
    <a href="${escapeHtml(config.app.dashboardUrl)}" class="dashboard-link">
      Go to Dashboard
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
      </svg>
    </a>
  `;

  const subtitleText = isFromCli
    ? "You can now close this window and return to your terminal."
    : "You can now manage your secrets from the dashboard.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - Setup Complete</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
    .subtitle {
      font-size: 14px;
      color: #9ca3af;
      margin-top: 8px;
    }
    .dashboard-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 32px;
      padding: 12px 24px;
      background: #111827;
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .dashboard-link:hover {
      background: #1f2937;
    }
    .dashboard-link svg {
      width: 16px;
      height: 16px;
    }
    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
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
      Setup complete
    </div>
    <h1>You're all set!</h1>
    <p>Keyway is now installed and you're logged in.</p>
    <p class="subtitle">${escapeHtml(subtitleText)}</p>
    ${actionHtml}
  </div>
</body>
</html>`;
}
