import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, users, deviceCodes } from '../../../db';
import { eq } from 'drizzle-orm';
import { exchangeCodeForToken, getUserFromToken } from '../../../utils/github';
import { trackEvent, identifyUser, AnalyticsEvents, getSignupSource } from '../../../utils/analytics';
import { generateDeviceCode, generateUserCode, DEVICE_FLOW_CONFIG } from '../../../utils/deviceCodes';
import { generateKeywayToken, getTokenExpiresAt } from '../../../utils/jwt';
import { config } from '../../../config';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../../lib';
import { authenticateGitHub } from '../../../middleware/auth';
import { encryptAccessToken } from '../../../utils/tokenEncryption';
import { signState, verifyState } from '../../../utils/state';
import { sendWelcomeEmail } from '../../../utils/email';

// Schemas
const DeviceFlowStartSchema = z.object({
  repository: z.string().optional(),
});

const DeviceFlowPollSchema = z.object({
  deviceCode: z.string().min(1),
});

// Helper to build the unified callback URL
function buildCallbackUrl(request: { headers: { 'x-forwarded-proto'?: string; host?: string }; hostname: string }): string {
  const protocol = request.headers['x-forwarded-proto'] || (config.server.isDevelopment ? 'http' : 'https');
  const host = request.headers.host || request.hostname;
  return `${protocol}://${host}/v1/auth/callback`;
}

// Helper to create or update user from GitHub data
async function upsertUser(githubUser: { githubId: number; username: string; email: string | null; avatarUrl: string | null }, accessToken: string) {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.githubId, githubUser.githubId),
  });

  const encryptedToken = await encryptAccessToken(accessToken);

  if (existingUser) {
    const [updatedUser] = await db
      .update(users)
      .set({
        username: githubUser.username,
        email: githubUser.email,
        avatarUrl: githubUser.avatarUrl,
        ...encryptedToken,
        updatedAt: new Date(),
      })
      .where(eq(users.githubId, githubUser.githubId))
      .returning();
    return { user: updatedUser, isNewUser: false };
  }

  const [newUser] = await db
    .insert(users)
    .values({
      githubId: githubUser.githubId,
      username: githubUser.username,
      email: githubUser.email,
      avatarUrl: githubUser.avatarUrl,
      ...encryptedToken,
    })
    .returning();
  return { user: newUser, isNewUser: true };
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
   */
  fastify.get('/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      fastify.log.warn({ error: query.error }, 'GitHub OAuth error');
      return reply.type('text/html').send(renderErrorPage('Authorization Denied', 'You denied the authorization request. You can close this window.'));
    }

    if (!query.code || !query.state) {
      throw new BadRequestError('Missing code or state parameter');
    }

    try {
      // Verify signed state to prevent CSRF attacks (CRIT-2 fix)
      const stateData = verifyState(query.state);
      if (!stateData) {
        throw new BadRequestError('Invalid or tampered state parameter');
      }
      const accessToken = await exchangeCodeForToken(query.code);
      const githubUser = await getUserFromToken(accessToken);
      const { user, isNewUser } = await upsertUser(githubUser, accessToken);

      if (stateData.type === 'web') {
        const keywayToken = generateKeywayToken({
          userId: user.id,
          githubId: user.githubId,
          username: user.username,
        });

        const signupSource = isNewUser ? getSignupSource(request.headers.referer) : undefined;

        trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
          username: githubUser.username,
          method: 'web_oauth',
          isNewUser,
          signupSource,
        });

        if (isNewUser) {
          trackEvent(user.id, AnalyticsEvents.USER_CREATED, {
            username: githubUser.username,
            signupSource,
            method: 'web_oauth',
          });

          identifyUser(user.id, {
            username: user.username,
            plan: user.plan,
            signupSource,
            signupTimestamp: user.createdAt.toISOString(),
          });

          // Send welcome email (fire and forget)
          if (user.email) {
            sendWelcomeEmail({ to: user.email, username: user.username });
          }
        }

        const isProduction = config.server.isProduction;
        const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds

        // Determine domain for cookie
        const host = (request.headers.host || '').split(':')[0];
        const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
        let domain: string | undefined;

        if (isProduction && !isLocalhost) {
          const parts = host.split('.');
          if (parts.length >= 2) {
            domain = `.${parts.slice(-2).join('.')}`;
          }
        }

        // Set session cookie with all security flags
        reply.setCookie('keyway_session', keywayToken, {
          path: '/',
          httpOnly: true, // Prevent XSS access
          secure: isProduction, // HTTPS only in production
          sameSite: 'lax', // CSRF protection
          maxAge,
          domain,
        });

        // Set flag cookie (readable by JavaScript for client-side auth status)
        reply.setCookie('keyway_logged_in', 'true', {
          path: '/',
          httpOnly: false, // Intentionally false - needed for client-side checks
          secure: isProduction,
          sameSite: 'lax',
          maxAge,
          domain,
        });

        // In development with different ports, pass token via URL for frontend to set cookies
        // In production, cookies work because same domain
        let redirectUrl = (stateData.redirectUri as string | null) || (isProduction ? 'https://keyway.sh/dashboard' : 'http://localhost:3100/dashboard');

        // If redirect URL is to a different port (dev mode), pass token via URL param
        const backendHost = request.headers.host || '';
        const redirectUrlObj = new URL(redirectUrl);
        if (!isProduction && backendHost.split(':')[0] === redirectUrlObj.hostname && backendHost !== `${redirectUrlObj.hostname}:${redirectUrlObj.port}`) {
          // Different ports on localhost - use callback with token
          const callbackUrl = new URL('/auth/callback', redirectUrl);
          callbackUrl.searchParams.set('token', keywayToken);
          callbackUrl.searchParams.set('redirect', redirectUrlObj.pathname);
          redirectUrl = callbackUrl.toString();
        }

        return reply.redirect(redirectUrl);
      } else if (stateData.deviceCodeId) {
        await db
          .update(deviceCodes)
          .set({
            status: 'approved',
            userId: user.id,
          })
          .where(eq(deviceCodes.id, stateData.deviceCodeId as string));

        trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
          username: githubUser.username,
          method: 'device_flow',
          isNewUser,
        });

        if (isNewUser) {
          trackEvent(user.id, AnalyticsEvents.USER_CREATED, {
            username: githubUser.username,
            signupSource: 'cli',
            method: 'device_flow',
          });

          identifyUser(user.id, {
            username: user.username,
            plan: user.plan,
            signupSource: 'cli',
            signupTimestamp: user.createdAt.toISOString(),
          });

          // Send welcome email (fire and forget)
          if (user.email) {
            sendWelcomeEmail({ to: user.email, username: user.username });
          }
        }

        return reply.type('text/html').send(renderSuccessPage(user.username));
      } else {
        throw new BadRequestError('Invalid state parameter');
      }
    } catch (error) {
      fastify.log.error({
        err: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        state: query.state?.substring(0, 50),
      }, 'OAuth callback error');
      trackEvent('anonymous', AnalyticsEvents.AUTH_FAILURE, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return reply.type('text/html').send(renderErrorPage('Authentication Error', 'An error occurred during authentication. Please try again.'));
    }
  });

  /**
   * GET /github/start
   * Start the web OAuth flow
   */
  fastify.get('/github/start', async (request, reply) => {
    const query = request.query as { redirect_uri?: string };
    const redirectUri = query.redirect_uri;

    if (redirectUri) {
      let isAllowed = config.cors.allowAll;
      if (!isAllowed) {
        try {
          const redirectUrl = new URL(redirectUri);
          const redirectOrigin = redirectUrl.origin;
          isAllowed = config.cors.allowedOrigins.some(origin => {
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
        fastify.log.warn({ redirectUri }, 'Blocked redirect to non-allowed origin');
        throw new BadRequestError('The redirect_uri is not in the allowed origins list');
      }
    }

    // Sign state with HMAC to prevent CSRF attacks (CRIT-2 fix)
    const state = signState({
      type: 'web',
      redirectUri: redirectUri || null,
    });

    const callbackUri = buildCallbackUrl(request);

    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', config.github.clientId);
    githubAuthUrl.searchParams.set('redirect_uri', callbackUri);
    githubAuthUrl.searchParams.set('scope', 'repo read:user user:email');
    githubAuthUrl.searchParams.set('state', state);

    return reply.redirect(githubAuthUrl.toString());
  });

  /**
   * POST /device/start
   * Start the device authorization flow
   */
  fastify.post('/device/start', async (request, reply) => {
    const body = DeviceFlowStartSchema.parse(request.body);

    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + DEVICE_FLOW_CONFIG.EXPIRES_IN * 1000);

    await db.insert(deviceCodes).values({
      deviceCode,
      userCode,
      status: 'pending',
      suggestedRepository: body.repository,
      expiresAt,
    });

    const protocol = request.headers['x-forwarded-proto'] || (config.server.isDevelopment ? 'http' : 'https');
    const verificationUri = `${protocol}://${request.hostname}/v1/auth/device/verify`;
    const verificationUriComplete = `${verificationUri}?user_code=${userCode}`;

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
  fastify.post('/device/poll', async (request, reply) => {
    const body = DeviceFlowPollSchema.parse(request.body);

    const deviceCodeRecord = await db.query.deviceCodes.findFirst({
      where: eq(deviceCodes.deviceCode, body.deviceCode),
      with: { user: true },
    });

    if (!deviceCodeRecord) {
      throw new NotFoundError('Invalid device code');
    }

    if (new Date() > deviceCodeRecord.expiresAt) {
      await db
        .update(deviceCodes)
        .set({ status: 'expired' })
        .where(eq(deviceCodes.deviceCode, body.deviceCode));

      // Note: Device flow responses intentionally include 'status' for CLI compatibility
      return reply.status(400).send({
        status: 'expired',
        error: 'device_code_expired',
        message: 'The device code has expired. Please restart the authentication flow.',
      });
    }

    if (deviceCodeRecord.status === 'pending') {
      return { status: 'pending' };
    }

    if (deviceCodeRecord.status === 'denied') {
      // Note: Device flow responses intentionally include 'status' for CLI compatibility
      return reply.status(403).send({
        status: 'denied',
        error: 'authorization_denied',
        message: 'User denied the authorization request.',
      });
    }

    if (deviceCodeRecord.status === 'expired') {
      // Note: Device flow responses intentionally include 'status' for CLI compatibility
      return reply.status(400).send({
        status: 'expired',
        error: 'device_code_expired',
        message: 'The device code has expired.',
      });
    }

    if (deviceCodeRecord.status === 'approved') {
      if (!deviceCodeRecord.user) {
        fastify.log.error({
          deviceCodeId: deviceCodeRecord.id,
          userId: deviceCodeRecord.userId,
          status: deviceCodeRecord.status,
        }, 'Device code approved but user not loaded');
        throw new Error('User not found for approved device code');
      }

      const keywayToken = generateKeywayToken({
        userId: deviceCodeRecord.user.id,
        githubId: deviceCodeRecord.user.githubId,
        username: deviceCodeRecord.user.username,
      });

      const expiresAt = getTokenExpiresAt(keywayToken);

      return {
        status: 'approved',
        keywayToken,
        githubLogin: deviceCodeRecord.user.username,
        expiresAt: expiresAt.toISOString(),
      };
    }

    return { status: 'pending' };
  });

  /**
   * GET /device/verify
   * Device verification page
   */
  fastify.get('/device/verify', async (request, reply) => {
    const query = request.query as { user_code?: string };
    const userCode = query.user_code || '';
    const autoSubmit = userCode.length === 9;

    // Track funnel: page view
    trackEvent('anonymous', AnalyticsEvents.DEVICE_VERIFY_PAGE_VIEW, {
      hasCode: autoSubmit,
    });

    reply.type('text/html').send(renderVerifyPage(userCode, autoSubmit));
  });

  /**
   * POST /device/verify
   * Submit device verification
   * Rate limited to 5 requests per minute to prevent brute force (CRIT-3 fix)
   */
  fastify.post('/device/verify', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = request.body as { user_code: string };
    const userCode = body.user_code.trim().toUpperCase();

    // Track funnel: form submitted
    trackEvent('anonymous', AnalyticsEvents.DEVICE_VERIFY_SUBMIT, {
      codeLength: userCode.length,
    });

    const deviceCodeRecord = await db.query.deviceCodes.findFirst({
      where: eq(deviceCodes.userCode, userCode),
    });

    if (!deviceCodeRecord) {
      return reply.type('text/html').send(renderErrorPage('Invalid Code', 'The code you entered is invalid or has expired.'));
    }

    if (new Date() > deviceCodeRecord.expiresAt) {
      return reply.type('text/html').send(renderErrorPage('Code Expired', 'This verification code has expired. Please restart the authentication flow.'));
    }

    // Sign state with HMAC to prevent CSRF attacks (CRIT-2 fix)
    const state = signState({ deviceCodeId: deviceCodeRecord.id });
    const callbackUri = buildCallbackUrl(request);

    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', config.github.clientId);
    githubAuthUrl.searchParams.set('redirect_uri', callbackUri);
    githubAuthUrl.searchParams.set('scope', 'repo read:user user:email');
    githubAuthUrl.searchParams.set('state', state);

    return reply.redirect(githubAuthUrl.toString());
  });

  /**
   * POST /token/validate
   * Validate a token
   */
  fastify.post('/token/validate', {
    preHandler: [authenticateGitHub],
  }, async (request) => {
    return {
      username: request.githubUser!.username,
      githubId: request.githubUser!.githubId,
    };
  });

  /**
   * POST /logout
   * Clear session cookie
   */
  fastify.post('/logout', async (request, reply) => {
    const isProduction = config.server.isProduction;

    // Determine domain for cookie
    const host = (request.headers.host || '').split(':')[0];
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
    let domain: string | undefined;

    if (isProduction && !isLocalhost) {
      const parts = host.split('.');
      if (parts.length >= 2) {
        domain = `.${parts.slice(-2).join('.')}`;
      }
    }

    // Clear session cookie with same security flags
    reply.clearCookie('keyway_session', {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      domain,
    });

    // Clear flag cookie
    reply.clearCookie('keyway_logged_in', {
      path: '/',
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      domain,
    });

    return { success: true, message: 'Logged out successfully' };
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

function renderSuccessPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keyway - Success</title>
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
    <h1>Success!</h1>
    <p>You have successfully authorized Keyway CLI. You can now close this window and return to your terminal.</p>
    <div class="user-info"><strong>Logged in as:</strong> ${username}</div>
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
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    h1 { font-size: 28px; margin-bottom: 12px; color: #1a202c; }
    p { color: #4a5568; margin-bottom: 24px; line-height: 1.6; }
    .info { background: #bee3f8; color: #2c5282; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    form { display: flex; flex-direction: column; gap: 16px; }
    input { padding: 12px 16px; font-size: 16px; border: 2px solid #e2e8f0; border-radius: 8px; text-transform: uppercase; letter-spacing: 2px; text-align: center; font-weight: 600; }
    input:focus { outline: none; border-color: #667eea; }
    button { background: #667eea; color: white; padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #5568d3; }
    button:disabled { background: #a0aec0; cursor: not-allowed; }
    .logo { font-size: 48px; text-align: center; margin-bottom: 20px; }
    .permissions { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-size: 14px; }
    .permissions h3 { font-size: 16px; margin-bottom: 12px; color: #2d3748; }
    .permissions ul { list-style: none; }
    .permissions li { padding: 6px 0; display: flex; align-items: flex-start; gap: 8px; }
    .yes { color: #38a169; font-weight: 600; }
    .no { color: #e53e3e; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🔐</div>
    <h1>Verify Your Device</h1>
    ${autoSubmit
      ? `<p>Code detected! Click below to continue with GitHub authentication.</p><div class="info">✅ Code <strong>${userCode}</strong> confirmed</div>`
      : '<p>Enter the code displayed on your device to continue with GitHub authentication.</p>'
    }
    <div class="permissions">
      <h3>🔒 What Keyway will access</h3>
      <ul>
        <li><span class="yes">✓</span> Check if you have admin/push access to repositories</li>
        <li><span class="yes">✓</span> Your GitHub username and email</li>
        <li><span class="no">✗</span> NEVER reads your repository code</li>
        <li><span class="no">✗</span> NEVER reads issues or pull requests</li>
      </ul>
    </div>
    <form id="verifyForm" action="/v1/auth/device/verify" method="POST">
      <input type="text" name="user_code" id="userCodeInput" placeholder="XXXX-XXXX" value="${userCode}" pattern="[A-Z0-9]{4}-[A-Z0-9]{4}" maxlength="9" required ${autoSubmit ? 'readonly' : 'autofocus'} />
      <button type="submit">${autoSubmit ? 'Continue with GitHub' : 'Continue with GitHub'}</button>
    </form>
  </div>
</body>
</html>`;
}
