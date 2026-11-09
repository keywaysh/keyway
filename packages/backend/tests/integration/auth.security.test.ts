/**
 * Security tests for the auth routes.
 *
 * The OAuth state of the device and web flows must be bound to the browser that
 *     started them (nonce cookie), device codes are approved only while pending, and a
 *     device code gives tokens to one poll only.
 * Everything the HTML pages print is escaped, the user code is validated, and only
 *     POST /device/verify accepts an HTML form body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { mockUser, mockDeviceCode, createMockDb, createMockGitHubUtils } from '../helpers/mocks';
import { signState, verifyState, hashStateNonce } from '../../src/utils/state';

vi.mock('../../src/db', () => {
  const mockDb = createMockDb();
  return {
    db: mockDb,
    users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
    vaults: { id: 'id' },
    secrets: { id: 'id' },
    deviceCodes: {
      id: 'id',
      deviceCode: 'deviceCode',
      userCode: 'userCode',
      status: 'status',
      expiresAt: 'expiresAt',
    },
  };
});

vi.mock('../../src/utils/github', () => createMockGitHubUtils());

vi.mock('../../src/utils/analytics', () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  getSignupSource: vi.fn().mockReturnValue('direct'),
  AnalyticsEvents: {
    AUTH_SUCCESS: 'api_auth_success',
    AUTH_FAILURE: 'api_auth_failure',
    USER_CREATED: 'api_user_created',
    DEVICE_VERIFY_PAGE_VIEW: 'api_device_verify_page_view',
    DEVICE_VERIFY_SUBMIT: 'api_device_verify_submit',
  },
}));

vi.mock('../../src/utils/email', () => ({
  sendWelcomeEmail: vi.fn(),
  sendTrialStartedEmail: vi.fn(),
}));

vi.mock('../../src/utils/tokenEncryption', () => ({
  encryptAccessToken: vi.fn().mockResolvedValue({
    encryptedAccessToken: 'encrypted-token',
    accessTokenIv: 'iv',
    accessTokenAuthTag: 'auth-tag',
  }),
  decryptAccessToken: vi.fn().mockResolvedValue('gho_decrypted_token'),
}));

vi.mock('../../src/services/github-app.service', () => ({
  handleInstallationCreated: vi.fn().mockResolvedValue(undefined),
  checkInstallationStatus: vi.fn().mockResolvedValue({ installed: true }),
}));

vi.mock('../../src/services/signup.service', () => ({
  handleNewUserSignup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test-agent' }),
  detectPlatform: vi.fn().mockReturnValue('web'),
}));

const NONCE_COOKIE = 'keyway_oauth_nonce';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function findCookie(response: InjectResponse, name: string) {
  return (response.cookies as Array<Record<string, any>>).find((c) => c.name === name);
}

function stateFromLocation(response: InjectResponse): string {
  const location = response.headers.location as string;
  const state = new URL(location).searchParams.get('state');
  expect(state).toBeTruthy();
  return state!;
}

/** An update chain whose conditional WHERE matched no row. */
function updateMatchingNoRow() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      }),
    }),
  };
}

/** Every value passed to db.update(...).set(...) during the test. */
async function setCalls(): Promise<Array<Record<string, unknown>>> {
  const { db } = await import('../../src/db');
  const calls: Array<Record<string, unknown>> = [];
  for (const result of (db.update as any).mock.results) {
    const chain = result.value;
    if (chain?.set?.mock) {
      for (const call of chain.set.mock.calls) {
        calls.push(call[0]);
      }
    }
  }
  return calls;
}

async function buildApp(): Promise<FastifyInstance> {
  // No global form parser: production registers none since form bodies are only parsed on the device verify form
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const { authRoutes } = await import('../../src/api/v1/routes/auth.routes');
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.ready();
  return app;
}

describe('Auth routes security', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { db } = await import('../../src/db');
    (db.query.deviceCodes.findFirst as any).mockResolvedValue({ ...mockDeviceCode, status: 'pending' });
    (db.query.users.findFirst as any).mockResolvedValue(mockUser);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Runs POST /device/verify like the browser form does, returns the nonce and the state. */
  async function startDeviceVerification() {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/verify',
      payload: `user_code=${mockDeviceCode.userCode}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(302);
    const nonce = findCookie(response, NONCE_COOKIE);
    expect(nonce).toBeDefined();
    return { nonce: nonce!.value as string, state: stateFromLocation(response) };
  }

  describe('OAuth state bound to the browser', () => {
    it('POST /device/verify sets a short-lived httpOnly nonce cookie scoped to the callback', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).toBe(302);
      const nonce = findCookie(response, NONCE_COOKIE);
      expect(nonce).toBeDefined();
      expect(nonce!.httpOnly).toBe(true);
      expect(String(nonce!.sameSite).toLowerCase()).toBe('lax');
      expect(nonce!.path).toBe('/v1/auth/callback');
      expect(nonce!.maxAge).toBeGreaterThan(0);
      expect(nonce!.maxAge).toBeLessThanOrEqual(600);
      expect(nonce!.value.length).toBeGreaterThanOrEqual(32);

      // The state carries the hash of the nonce, never the nonce itself
      const state = stateFromLocation(response);
      expect(state).not.toContain(nonce!.value);
      const data = verifyState(state)!;
      expect(data.nonceHash).toBe(hashStateNonce(nonce!.value));
    });

    it('GET /github/start sets the nonce cookie and binds the web state to it', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/auth/github/start' });

      expect(response.statusCode).toBe(302);
      const nonce = findCookie(response, NONCE_COOKIE);
      expect(nonce).toBeDefined();
      expect(nonce!.httpOnly).toBe(true);
      expect(nonce!.path).toBe('/v1/auth/callback');
      expect(verifyState(stateFromLocation(response))!.nonceHash).toBe(hashStateNonce(nonce!.value));
    });

    it('GET /github/start returns to a provider authorization link on this API after sign-in', async () => {
      // Where GET /v1/integrations/:provider/authorize sends a ticket opened without a session
      const returnTo = '/v1/integrations/vercel/authorize?ticket=eyJwYXlsb2Fk.c2lnbmF0dXJl-_&after_login=1';
      const start = await app.inject({
        method: 'GET',
        url: `/v1/auth/github/start?redirect_uri=${encodeURIComponent(returnTo)}`,
      });
      expect(start.statusCode).toBe(302);
      expect(verifyState(stateFromLocation(start))!.redirectUri).toBe(returnTo);

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(stateFromLocation(start))}`,
        cookies: { [NONCE_COOKIE]: findCookie(start, NONCE_COOKIE)!.value },
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe(returnTo);
      expect(findCookie(callback, 'keyway_session')?.value).toBeTruthy();
    });

    it('GET /github/start accepts no other path, nor anything that leaves this host', async () => {
      for (const redirectUri of [
        '//evil.example/x',
        '/\\evil.example',
        '/v1/auth/callback',
        '/v1/integrations/vercel/callback?code=x',
        '/v1/integrations/vercel/authorize?ticket=abc.def',
        '/v1/integrations/vercel/authorize?ticket=abc.def&after_login=1&next=//evil.example',
        '/v1/integrations/vercel/authorize?ticket=abc.def&after_login=1#//evil.example',
        '/v1/integrations/../../evil/authorize?ticket=abc.def&after_login=1',
        '/v1/integrations/vercel/authorize?ticket=a%2F%2Fevil&after_login=1',
        'https://evil.example/v1/integrations/vercel/authorize?ticket=abc.def&after_login=1',
      ]) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/auth/github/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
        });
        expect(response.statusCode, redirectUri).toBe(400);
        expect(findCookie(response, NONCE_COOKIE), redirectUri).toBeUndefined();
      }
    });

    it('callback without the nonce cookie does not approve the device code', async () => {
      const { db } = await import('../../src/db');
      const { exchangeCodeForToken } = await import('../../src/utils/github');
      const { state } = await startDeviceVerification();
      vi.clearAllMocks();

      // The victim's browser follows the attacker's GitHub URL: no nonce cookie
      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=victim-code&state=${encodeURIComponent(state)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Authentication Error');
      expect(response.body).not.toContain('Logged in successfully');
      expect(exchangeCodeForToken).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('callback with a nonce cookie from another flow does not approve the device code', async () => {
      const { db } = await import('../../src/db');
      const { state } = await startDeviceVerification();
      const other = await startDeviceVerification();
      vi.clearAllMocks();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=victim-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: other.nonce },
      });

      expect(response.body).toContain('Authentication Error');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('callback with the matching nonce approves the pending code and clears the cookie', async () => {
      const { nonce, state } = await startDeviceVerification();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Logged in successfully');
      expect(await setCalls()).toContainEqual(
        expect.objectContaining({ status: 'approved', userId: mockUser.id })
      );
      const cleared = findCookie(response, NONCE_COOKIE);
      expect(cleared).toBeDefined();
      expect(cleared!.value).toBe('');
    });

    it('web callback without the nonce cookie does not open a session', async () => {
      const start = await app.inject({ method: 'GET', url: '/v1/auth/github/start' });
      const state = stateFromLocation(start);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=attacker-code&state=${encodeURIComponent(state)}`,
      });

      expect(response.body).toContain('Authentication Error');
      expect(findCookie(response, 'keyway_session')).toBeUndefined();
    });

    it('web callback with the matching nonce opens a session', async () => {
      const start = await app.inject({ method: 'GET', url: '/v1/auth/github/start' });
      const nonce = findCookie(start, NONCE_COOKIE)!.value;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(stateFromLocation(start))}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.statusCode).toBe(302);
      expect(findCookie(response, 'keyway_session')?.value).toBeTruthy();
    });

    it('the device callback reads the device code once', async () => {
      const { db } = await import('../../src/db');
      const { nonce, state } = await startDeviceVerification();
      (db.query.deviceCodes.findFirst as any).mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.body).toContain('Logged in successfully');
      expect(db.query.deviceCodes.findFirst).toHaveBeenCalledTimes(1);
    });

    it('callback does not approve a device code that is no longer pending', async () => {
      const { db } = await import('../../src/db');
      const { nonce, state } = await startDeviceVerification();
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'approved',
        userId: 'someone-else',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.body).not.toContain('Logged in successfully');
      expect(await setCalls()).not.toContainEqual(expect.objectContaining({ status: 'approved' }));
    });

    it('callback does not approve when the code stopped being pending meanwhile (conditional update)', async () => {
      const { db } = await import('../../src/db');
      const { nonce, state } = await startDeviceVerification();
      (db.update as any).mockReturnValueOnce(updateMatchingNoRow());

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.body).not.toContain('Logged in successfully');
    });

    it('POST /device/verify refuses a code that is not pending', async () => {
      const { db } = await import('../../src/db');
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'approved',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).not.toBe(302);
      expect(findCookie(response, NONCE_COOKIE)).toBeUndefined();
    });

    it('the github_app_install state cannot approve a device code through the OAuth code branch', async () => {
      const { db } = await import('../../src/db');
      // Even when the state carries a nonce the browser holds
      const nonce = 'n'.repeat(43);
      const state = signState({
        deviceCodeId: mockDeviceCode.id,
        type: 'github_app_install',
        nonceHash: hashStateNonce(nonce),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=victim-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.body).toContain('Authentication Error');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('the install callback does not approve a pending device code (unbound install state)', async () => {
      const { db } = await import('../../src/db');
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({ ...mockDeviceCode, status: 'pending' });
      // What /device/start used to hand out: an install state bound to no browser
      const installState = signState({ deviceCodeId: mockDeviceCode.id, type: 'github_app_install' });

      // The victim installs the app from the link the attacker sent
      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?setup_action=install&installation_id=42&code=victim-code&state=${encodeURIComponent(installState)}`,
      });

      expect(await setCalls()).not.toContainEqual(expect.objectContaining({ status: 'approved' }));
      expect(response.body).not.toContain('return to your terminal');
    });

    it('verify page warns to continue only for a login started by the user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/device/verify?user_code=ABCDE-12345',
      });

      expect(response.body).toContain('Only continue if you started');
      expect(response.body).toContain('keyway login');
      expect(response.body).toContain('the code matches your terminal');
    });
  });

  describe('GitHub App install callback: no login CSRF', () => {
    const USER_INSTALLATIONS_URL = /\/user\/installations\b/;

    /** GitHub's GET /user/installations for the token of the code, listing these installations. */
    function stubUserInstallations(installationIds: number[]) {
      const fetchMock = vi.fn(async (input: unknown) => {
        if (USER_INSTALLATIONS_URL.test(String(input))) {
          return new Response(
            JSON.stringify({
              total_count: installationIds.length,
              installations: installationIds.map((id) => ({ id })),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('not found', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function expectNoSession(response: InjectResponse) {
      expect(findCookie(response, 'keyway_session')).toBeUndefined();
      expect(findCookie(response, 'keyway_logged_in')).toBeUndefined();
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /**
     * The chained CLI flow up to the GitHub App install page, in one browser: POST /device/verify,
     * then the OAuth callback finds the app not installed and sends the browser to install it.
     */
    async function chainToAppInstall() {
      const { db } = await import('../../src/db');
      const { checkInstallationStatus } = await import('../../src/services/github-app.service');
      const { nonce, state } = await startDeviceVerification();
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'pending',
        suggestedRepository: 'testuser/test-repo',
      });
      (checkInstallationStatus as any).mockResolvedValueOnce({ installed: false });

      const oauth = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });
      expect(oauth.statusCode).toBe(302);
      expect(await setCalls()).toContainEqual(
        expect.objectContaining({ status: 'oauth_complete', userId: mockUser.id })
      );
      const installUrl = new URL(oauth.headers.location as string);
      const installState = installUrl.searchParams.get('state')!;
      const installNonce = findCookie(oauth, NONCE_COOKIE);
      return { oauth, installState, installNonce };
    }

    it('a direct install callback does not open a session (attacker code sent to a victim)', async () => {
      stubUserInstallations([42]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/callback?setup_action=install&installation_id=42&code=attacker-code',
      });

      expectNoSession(response);
      // Into the normal web login, bound to this browser
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/v1/auth/github/start');
    });

    it('an update callback (setup_action=update) does not open a session either', async () => {
      stubUserInstallations([42]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/callback?setup_action=update&installation_id=42&code=attacker-code',
      });

      expectNoSession(response);
      expect(response.headers.location).toBe('/v1/auth/github/start');
    });

    it('records the installation for the user of the code when that user can see it', async () => {
      const { handleInstallationCreated } = await import('../../src/services/github-app.service');
      const fetchMock = stubUserInstallations([7, 42]);

      await app.inject({
        method: 'GET',
        url: '/v1/auth/callback?setup_action=install&installation_id=42&code=good-code',
      });

      expect(String(fetchMock.mock.calls[0][0])).toMatch(USER_INSTALLATIONS_URL);
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
        Authorization: expect.stringContaining('Bearer '),
      });
      expect(handleInstallationCreated).toHaveBeenCalledWith(42, mockUser.id);
    });

    it("does not record an installation the code's user cannot see", async () => {
      const { handleInstallationCreated } = await import('../../src/services/github-app.service');
      stubUserInstallations([7]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/callback?setup_action=install&installation_id=42&code=attacker-code',
      });

      expect(handleInstallationCreated).not.toHaveBeenCalled();
      expectNoSession(response);
    });

    it('an install state without the browser nonce neither approves the device code nor opens a session', async () => {
      const { db } = await import('../../src/db');
      stubUserInstallations([42]);
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
      });
      const installState = signState({ deviceCodeId: mockDeviceCode.id, type: 'github_app_install' });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?setup_action=install&installation_id=42&code=c&state=${encodeURIComponent(installState)}`,
      });

      expect(await setCalls()).not.toContainEqual(expect.objectContaining({ status: 'approved' }));
      expect(response.body).not.toContain('return to your terminal');
      expectNoSession(response);
    });

    it('the chained flow binds the install state to the browser that did the OAuth step', async () => {
      const { installState, installNonce } = await chainToAppInstall();

      expect(installNonce).toBeDefined();
      expect(installNonce!.value).toBeTruthy();
      expect(installNonce!.path).toBe('/v1/auth/callback');
      const data = verifyState(installState)!;
      expect(data.type).toBe('github_app_install');
      expect(data.nonceHash).toBe(hashStateNonce(installNonce!.value));
    });

    it('the chained flow approves the device code back in the same browser, without a session', async () => {
      const { db } = await import('../../src/db');
      stubUserInstallations([42]);
      const { installState, installNonce } = await chainToAppInstall();
      vi.clearAllMocks();
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
      });
      (db.query.users.findFirst as any).mockResolvedValue(mockUser);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?setup_action=install&installation_id=42&code=c&state=${encodeURIComponent(installState)}`,
        cookies: { [NONCE_COOKIE]: installNonce!.value },
      });

      expect(await setCalls()).toContainEqual(expect.objectContaining({ status: 'approved' }));
      expect(response.body).toContain('return to your terminal');
      expectNoSession(response);
      expect(findCookie(response, NONCE_COOKIE)?.value).toBe('');
    });

    it('the chained install state does not work in another browser', async () => {
      const { db } = await import('../../src/db');
      stubUserInstallations([42]);
      const { installState } = await chainToAppInstall();
      const other = await startDeviceVerification();
      vi.clearAllMocks();
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?setup_action=install&installation_id=42&code=c&state=${encodeURIComponent(installState)}`,
        cookies: { [NONCE_COOKIE]: other.nonce },
      });

      expect(await setCalls()).not.toContainEqual(expect.objectContaining({ status: 'approved' }));
      expectNoSession(response);
    });
  });

  describe('a device code gives tokens once', () => {
    it('marks the device code consumed when it returns the token', async () => {
      const { db } = await import('../../src/db');
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'approved',
        userId: mockUser.id,
        user: mockUser,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: { deviceCode: mockDeviceCode.deviceCode },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).keywayToken).toBeTruthy();
      const calls = await setCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].status).not.toBe('approved');
      expect(calls[0].status).not.toBe('pending');
    });

    it('does not mint a token when another poll consumed the code first', async () => {
      const { db } = await import('../../src/db');
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'approved',
        userId: mockUser.id,
        user: mockUser,
      });
      (db.update as any).mockReturnValueOnce(updateMatchingNoRow());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: { deviceCode: mockDeviceCode.deviceCode },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).not.toHaveProperty('keywayToken');
    });

    it('consumes an oauth_complete code when the poll detects the installation', async () => {
      const { db } = await import('../../src/db');
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
        suggestedRepository: 'testuser/test-repo',
      });
      (db.update as any).mockReturnValueOnce(updateMatchingNoRow());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: { deviceCode: mockDeviceCode.deviceCode },
      });

      // A concurrent poll already took the token
      expect(JSON.parse(response.body)).not.toHaveProperty('keywayToken');
    });

    it('keeps polling when the install callback approved the code meanwhile', async () => {
      // The poll read "oauth_complete", then the chained install callback moved the code
      // to "approved" before the conditional consume: the code is unused, so the CLI must
      // keep polling (the next poll takes the "approved" branch) instead of aborting.
      const { db } = await import('../../src/db');
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
        suggestedRepository: 'testuser/test-repo',
      });
      (db.update as any).mockReturnValueOnce(updateMatchingNoRow());

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: { deviceCode: mockDeviceCode.deviceCode },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'pending' });
    });
  });

  describe('HTML injection and form bodies', () => {
    it('GET /device/verify rejects a user_code that is not a code, without reflecting it', async () => {
      const payload = '"><script>alert(1)</script>';
      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/device/verify?user_code=${encodeURIComponent(payload)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('<script>alert(1)</script>');
      expect(response.body).not.toContain('"><');
    });

    it('GET /device/verify normalizes a valid lowercase code', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/device/verify?user_code=abcde-12345',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('value="ABCDE-12345"');
    });

    it('POST /device/verify without a body returns 400', async () => {
      const response = await app.inject({ method: 'POST', url: '/v1/auth/device/verify' });
      expect(response.statusCode).toBe(400);
    });

    it('POST /device/verify with a JSON body missing user_code returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('POST /device/verify with a non-string user_code returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: { user_code: 12345 },
      });
      expect(response.statusCode).toBe(400);
    });

    it('POST /device/verify rejects a malformed code without reflecting it', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${encodeURIComponent('<img src=x onerror=alert(1)>')}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('<img src=x');
    });

    it('POST /device/verify refuses a form posted from another site', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: {
          host: 'api.keyway.test',
          origin: 'https://evil.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(findCookie(response, NONCE_COOKIE)).toBeUndefined();
    });

    it('POST /device/verify refuses a cross-site request without Origin (Sec-Fetch-Site)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: {
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/x-www-form-urlencoded',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('POST /device/verify accepts the form posted from the verify page itself', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: {
          host: 'api.keyway.test',
          origin: 'https://api.keyway.test',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/x-www-form-urlencoded',
        },
      });

      expect(response.statusCode).toBe(302);
    });

    // Real browser submissions of the verify form. helmet sends Referrer-Policy: no-referrer,
    // under which a form POST carries `Origin: null` even from the page itself (Fetch spec)
    function postVerifyForm(headers: Record<string, string>) {
      return app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: {
          host: 'api.keyway.test',
          'content-type': 'application/x-www-form-urlencoded',
          ...headers,
        },
      });
    }

    it('POST /device/verify accepts the verify page form of a browser under no-referrer (Origin: null, same-origin)', async () => {
      const response = await postVerifyForm({ origin: 'null', 'sec-fetch-site': 'same-origin' });

      expect(response.statusCode).toBe(302);
      expect(findCookie(response, NONCE_COOKIE)).toBeDefined();
    });

    it('POST /device/verify accepts a form the user navigated to directly (Sec-Fetch-Site: none)', async () => {
      const response = await postVerifyForm({ origin: 'null', 'sec-fetch-site': 'none' });
      expect(response.statusCode).toBe(302);
    });

    it('POST /device/verify refuses Origin: null from another site (Sec-Fetch-Site: cross-site)', async () => {
      const response = await postVerifyForm({ origin: 'null', 'sec-fetch-site': 'cross-site' });

      expect(response.statusCode).toBe(403);
      expect(findCookie(response, NONCE_COOKIE)).toBeUndefined();
    });

    it('POST /device/verify refuses a sibling subdomain (Sec-Fetch-Site: same-site)', async () => {
      const response = await postVerifyForm({
        origin: 'https://app.keyway.test',
        'sec-fetch-site': 'same-site',
      });
      expect(response.statusCode).toBe(403);
    });

    it('POST /device/verify refuses a real cross-site origin with Sec-Fetch-Site', async () => {
      const response = await postVerifyForm({
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      });
      expect(response.statusCode).toBe(403);
    });

    it('POST /device/verify refuses Origin: null when the browser sends no Sec-Fetch-Site (fail closed)', async () => {
      const response = await postVerifyForm({ origin: 'null' });
      expect(response.statusCode).toBe(403);
    });

    it('POST /device/verify accepts the real same-host Origin of a browser without Sec-Fetch-Site', async () => {
      const response = await postVerifyForm({ origin: 'https://api.keyway.test' });
      expect(response.statusCode).toBe(302);
    });

    it('GET /device/verify is served with Referrer-Policy: same-origin, over helmet', async () => {
      const helmet = (await import('@fastify/helmet')).default;
      const withHelmet = Fastify({ logger: false });
      await withHelmet.register(helmet);
      await withHelmet.register(cookie);
      const { authRoutes } = await import('../../src/api/v1/routes/auth.routes');
      await withHelmet.register(authRoutes, { prefix: '/v1/auth' });
      await withHelmet.ready();

      // So that browsers without Sec-Fetch-Site send the real Origin on the form POST
      const response = await withHelmet.inject({
        method: 'GET',
        url: '/v1/auth/device/verify?user_code=ABCDE-12345',
      });
      const other = await withHelmet.inject({ method: 'POST', url: '/v1/auth/logout' });
      await withHelmet.close();

      expect(response.statusCode).toBe(200);
      expect(response.headers['referrer-policy']).toBe('same-origin');
      // Only this page: the rest of the API keeps helmet's no-referrer
      expect(other.headers['referrer-policy']).toBe('no-referrer');
    });

    it('success page escapes the GitHub username', async () => {
      const { db } = await import('../../src/db');
      const { nonce, state } = await startDeviceVerification();
      (db.insert as any).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ ...mockUser, username: '<img src=x onerror=alert(1)>' }]),
          }),
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/auth/callback?code=good-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: nonce },
      });

      expect(response.body).toContain('Logged in successfully');
      expect(response.body).not.toContain('<img src=x');
      expect(response.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('POST /device/verify keeps its 5 per minute limit inside the form scope', async () => {
      const rateLimit = (await import('@fastify/rate-limit')).default;
      const limited = Fastify({ logger: false });
      await limited.register(rateLimit, { max: 1000, timeWindow: '15 minutes' });
      await limited.register(cookie);
      const { authRoutes } = await import('../../src/api/v1/routes/auth.routes');
      await limited.register(authRoutes, { prefix: '/v1/auth' });
      await limited.ready();

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const response = await limited.inject({
          method: 'POST',
          url: '/v1/auth/device/verify',
          payload: `user_code=${mockDeviceCode.userCode}`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        statuses.push(response.statusCode);
      }
      await limited.close();

      expect(statuses.slice(0, 5)).toEqual([302, 302, 302, 302, 302]);
      expect(statuses[5]).toBe(429);
    });

    it('only POST /device/verify accepts an HTML form body', async () => {
      const verify = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/verify',
        payload: `user_code=${mockDeviceCode.userCode}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(verify.statusCode).toBe(302);

      for (const url of ['/v1/auth/device/start', '/v1/auth/device/poll', '/v1/auth/logout']) {
        const response = await app.inject({
          method: 'POST',
          url,
          payload: 'deviceCode=x',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        expect(response.statusCode, url).toBe(415);
      }
    });
  });
});
