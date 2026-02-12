import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, users, deviceCodes } from "../../../db";
import { eq, and } from "drizzle-orm";
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
import { signState, verifyState } from "../../../utils/state";
import { handleNewUserSignup } from "../../../services/signup.service";
import { sendData, sendNoContent } from "../../../lib/response";
import {
  handleInstallationCreated,
  checkInstallationStatus,
} from "../../../services/github-app.service";
import { logActivity, extractRequestInfo, detectPlatform } from "../../../services";

// Schemas
const DeviceFlowStartSchema = z.object({
  repository: z.string().optional(),
  ownerId: z.number().optional(),
  repoId: z.number().optional(),
});

const DeviceFlowPollSchema = z.object({
  deviceCode: z.string().min(1),
});

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

    // Handle GitHub App installation callback (no state, has installation_id)
    // This happens when user installs the app directly from GitHub
    // setup_action can be 'install' (new installation) or 'update' (permission update)
    if (
      (query.setup_action === "install" || query.setup_action === "update") &&
      query.installation_id
    ) {
      fastify.log.info(
        { installationId: query.installation_id, setupAction: query.setup_action },
        "GitHub App installation callback"
      );

      // If there's a code, exchange it for a user token and process the installation
      if (query.code) {
        try {
          const accessToken = await exchangeCodeForToken(query.code);
          const githubUser = await getUserFromToken(accessToken);
          const { user, isNewUser } = await upsertUser(githubUser, accessToken);

          // Fetch installation details from GitHub API and store in DB
          const installationId = parseInt(query.installation_id, 10);
          await handleInstallationCreated(installationId, user.id);

          // If we have a signed state parameter from CLI, approve that specific device code
          let isFromCli = false;
          if (query.state) {
            try {
              const stateData = verifyState(query.state as string);
              if (stateData?.deviceCodeId && stateData?.type === "github_app_install") {
                // Check if this is a chained flow (oauth_complete) or direct
                const deviceCodeRecord = await db.query.deviceCodes.findFirst({
                  where: eq(deviceCodes.id, stateData.deviceCodeId as string),
                });

                if (deviceCodeRecord?.status === "oauth_complete") {
                  // Chained flow: OAuth already done, userId already set, just approve
                  await db
                    .update(deviceCodes)
                    .set({ status: "approved" })
                    .where(eq(deviceCodes.id, stateData.deviceCodeId as string));

                  fastify.log.info(
                    {
                      deviceCodeId: stateData.deviceCodeId,
                      userId: deviceCodeRecord.userId,
                    },
                    "Device code approved after GitHub App installation (chained flow)"
                  );
                } else {
                  // Direct flow: user did OAuth via the app installation
                  await db
                    .update(deviceCodes)
                    .set({ status: "approved", userId: user.id })
                    .where(eq(deviceCodes.id, stateData.deviceCodeId as string));

                  fastify.log.info(
                    {
                      deviceCodeId: stateData.deviceCodeId,
                      userId: user.id,
                      username: user.username,
                    },
                    "Device code approved via state parameter"
                  );
                }
                isFromCli = true;
              }
            } catch (err) {
              fastify.log.warn({ error: err }, "Failed to verify state in GitHub App callback");
            }
          }

          // Log user login activity (GitHub App install flow)
          const { ipAddress, userAgent } = extractRequestInfo(request);
          await logActivity({
            userId: user.id,
            action: "user_login",
            platform: isFromCli ? "cli" : detectPlatform(userAgent),
            ipAddress,
            userAgent,
            metadata: {
              method: "github_app_install",
              isNewUser,
              installationId,
            },
          });

          trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
            username: githubUser.username,
            method: "github_app_install",
            isNewUser,
            installationId,
          });

          if (isNewUser) {
            await handleNewUserSignup({
              user,
              signupSource: "github_app_install",
              method: "github_app_install",
            });
          }

          // CLI flow: show "return to terminal" page
          if (isFromCli) {
            return reply
              .type("text/html")
              .send(renderInstallSuccessPage(query.installation_id, true));
          }

          // Web flow (direct install from GitHub Marketplace): set cookies and redirect to dashboard
          const keywayToken = generateKeywayToken({
            userId: user.id,
            forgeType: user.forgeType,
            forgeUserId: user.forgeUserId,
            username: user.username,
          });
          setSessionCookies(reply, request, keywayToken);
          return reply.redirect(config.app.dashboardUrl);
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

      // No code - just installation ID, show success page (origin unknown, assume web)
      return reply.type("text/html").send(renderInstallSuccessPage(query.installation_id, false));
    }

    if (!query.code || !query.state) {
      throw new BadRequestError("Missing code or state parameter");
    }

    try {
      // Verify signed state to prevent CSRF attacks (CRIT-2 fix)
      const stateData = verifyState(query.state);
      if (!stateData) {
        throw new BadRequestError("Invalid or tampered state parameter");
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
      } else if (stateData.deviceCodeId) {
        // Get device code to check for suggestedRepository
        const deviceCodeRecord = await db.query.deviceCodes.findFirst({
          where: eq(deviceCodes.id, stateData.deviceCodeId as string),
        });

        // Check if we should chain to GitHub App installation
        if (deviceCodeRecord?.suggestedRepository) {
          const [owner, repo] = deviceCodeRecord.suggestedRepository.split("/");

          if (owner && repo) {
            try {
              const installStatus = await checkInstallationStatus(owner, repo);

              if (!installStatus.installed) {
                // DON'T approve yet - mark as oauth_complete and redirect to app install
                await db
                  .update(deviceCodes)
                  .set({ status: "oauth_complete", userId: user.id })
                  .where(eq(deviceCodes.id, stateData.deviceCodeId as string));

                // Build GitHub App install URL with state
                const appInstallState = signState({
                  deviceCodeId: stateData.deviceCodeId,
                  type: "github_app_install",
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
                    deviceCodeId: stateData.deviceCodeId,
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
        await db
          .update(deviceCodes)
          .set({
            status: "approved",
            userId: user.id,
          })
          .where(eq(deviceCodes.id, stateData.deviceCodeId as string));

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
          state: query.state?.substring(0, 50),
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
      let isAllowed = config.cors.allowAll;
      if (!isAllowed) {
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

    // Sign state with HMAC to prevent CSRF attacks (CRIT-2 fix)
    const state = signState({
      type: "web",
      redirectUri: redirectUri || null,
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

    const [deviceCodeRecord] = await db
      .insert(deviceCodes)
      .values({
        deviceCode,
        userCode,
        status: "pending",
        suggestedRepository: body.repository,
        suggestedOwnerId: body.ownerId, // For deep linking in chained OAuth flow
        suggestedRepoId: body.repoId, // For deep linking in chained OAuth flow
        expiresAt,
      })
      .returning({ id: deviceCodes.id });

    const protocol =
      request.headers["x-forwarded-proto"] || (config.server.isDevelopment ? "http" : "https");
    const verificationUri = `${protocol}://${request.hostname}/v1/auth/device/verify`;
    const verificationUriComplete = `${verificationUri}?user_code=${userCode}`;

    // Sign state with device code ID for GitHub App installation callback
    const state = signState({
      deviceCodeId: deviceCodeRecord.id,
      type: "github_app_install",
    });

    // Build GitHub App install URL with deep linking if repo IDs are provided
    let githubAppInstallUrl: string;
    if (body.ownerId && body.repoId) {
      // Deep link: pre-select the repo in GitHub's installation UI
      // Format: /permissions?suggested_target_id=OWNER_ID&repository_ids[]=REPO_ID&state=...
      githubAppInstallUrl = `${config.githubApp.installUrl}/permissions?suggested_target_id=${body.ownerId}&repository_ids[]=${body.repoId}&state=${encodeURIComponent(state)}`;
    } else {
      // Standard URL without deep linking
      githubAppInstallUrl = `${config.githubApp.installUrl}?state=${encodeURIComponent(state)}`;
    }

    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn: DEVICE_FLOW_CONFIG.EXPIRES_IN,
      interval: DEVICE_FLOW_CONFIG.POLL_INTERVAL,
      githubAppInstallUrl,
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
              // Installation now available, approve the device code
              await db
                .update(deviceCodes)
                .set({ status: "approved" })
                .where(eq(deviceCodes.id, deviceCodeRecord.id));

              // Load user and return token
              const user = await db.query.users.findFirst({
                where: eq(users.id, deviceCodeRecord.userId),
              });

              if (user) {
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
    const query = request.query as { user_code?: string };
    const userCode = query.user_code || "";
    const autoSubmit = userCode.length === 11; // XXXXX-XXXXX = 11 chars

    // Track funnel: page view
    trackEvent("anonymous", AnalyticsEvents.DEVICE_VERIFY_PAGE_VIEW, {
      hasCode: autoSubmit,
    });

    reply.type("text/html").send(renderVerifyPage(userCode, autoSubmit));
  });

  /**
   * POST /device/verify
   * Submit device verification
   * Rate limited to 5 requests per minute to prevent brute force (CRIT-3 fix)
   */
  fastify.post(
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
      const body = request.body as { user_code: string };
      const userCode = body.user_code.trim().toUpperCase();

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
          .send(renderErrorPage("Invalid Code", "The code you entered is invalid or has expired."));
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

      // Sign state with HMAC to prevent CSRF attacks (CRIT-2 fix)
      const state = signState({ deviceCodeId: deviceCodeRecord.id });
      const callbackUri = buildCallbackUrl(request);

      const githubAuthUrl = new URL(`${config.github.url}/login/oauth/authorize`);
      githubAuthUrl.searchParams.set("client_id", config.github.clientId);
      githubAuthUrl.searchParams.set("redirect_uri", callbackUri);
      githubAuthUrl.searchParams.set("scope", "read:user user:email read:org");
      githubAuthUrl.searchParams.set("state", state);

      return reply.redirect(githubAuthUrl.toString());
    }
  );

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
      <a href="${config.app.frontendUrl}">Return to Keyway</a>
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
      <strong>Logged in as:</strong> ${username}
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
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      ${keywayLogoSvg}
      <span>Keyway</span>
    </div>
    <h1>Verify Your Device</h1>
    ${
      autoSubmit
        ? `<p class="subtitle">Code detected! Click below to continue.</p>
         <div class="code-confirmed">
           <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
             <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
           </svg>
           Code <strong>${userCode}</strong> confirmed
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
      <input type="text" name="user_code" id="userCodeInput" placeholder="XXXXX-XXXXX" value="${userCode}" pattern="[A-Z0-9]{5}-[A-Z0-9]{5}" maxlength="11" required ${autoSubmit ? "readonly" : "autofocus"} />
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
    <a href="${config.app.dashboardUrl}" class="dashboard-link">
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
    <p class="subtitle">${subtitleText}</p>
    ${actionHtml}
  </div>
</body>
</html>`;
}
