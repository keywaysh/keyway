/**
 * Security tests for the provider OAuth routes.
 *
 * The CLI must not put its JWT in a browser URL. It gets a single-use ticket (10 minutes)
 *     from POST /:provider/authorize-ticket (Bearer auth) and opens /authorize?ticket=.
 *     The legacy ?token= of CLI versions before 0.7.0 is refused with an upgrade message.
 * The state signed at /authorize is bound to the browser by a nonce cookie.
 * Provider usernames and error descriptions are escaped in the HTML pages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { mockUser, createMockDb, createMockGitHubUtils } from '../helpers/mocks';
import { signState, verifyState, hashStateNonce } from '../../src/utils/state';
import { generateKeywayToken } from '../../src/utils/jwt';

const VALID_JWT = 'header.payload.signature-of-the-cli-jwt';

vi.mock('../../src/db', () => {
  const db = createMockDb();
  (db.query as any).providerConnections = {
    findFirst: vi.fn().mockResolvedValue({ id: 'conn-1', userId: 'test-user-id-123', provider: 'vercel' }),
  };
  return {
    db,
    users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
    vaults: { id: 'id', repoFullName: 'repoFullName' },
    providerConnections: { id: 'id', userId: 'userId', provider: 'provider' },
  };
});

vi.mock('../../src/utils/github', () => createMockGitHubUtils());

vi.mock('../../src/utils/permissions', () => ({
  requireSyncPermission: vi.fn().mockResolvedValue(undefined),
  requireEnvironmentPermission: vi.fn().mockResolvedValue(undefined),
}));

// Bearer-only authentication, like the middleware once ?token= is no longer read globally
vi.mock('../../src/middleware/auth', async () => {
  const { UnauthorizedError } = await import('../../src/lib');
  return {
    authenticateGitHub: vi.fn(async (request: any) => {
      if (request.headers.authorization !== `Bearer ${VALID_JWT}`) {
        throw new UnauthorizedError('Authentication required');
      }
      request.vcsUser = {
        forgeType: mockUser.forgeType,
        forgeUserId: mockUser.forgeUserId,
        username: mockUser.username,
        email: mockUser.email,
        avatarUrl: mockUser.avatarUrl,
      };
      request.githubUser = request.vcsUser;
    }),
    requireApiKeyScope: vi.fn(() => async () => {}),
  };
});

const provider = {
  name: 'vercel',
  displayName: 'Vercel',
  getAuthorizationUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  getUser: vi.fn(),
};

vi.mock('../../src/services/providers', () => ({
  getProvider: vi.fn((name: string) => (['vercel', 'netlify'].includes(name) ? provider : null)),
  getAvailableProviders: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/services/integration.service', () => ({
  listConnections: vi.fn().mockResolvedValue([]),
  createConnection: vi.fn().mockResolvedValue({ id: 'conn-1' }),
  deleteConnection: vi.fn(),
  listProviderProjects: vi.fn(),
  listAllProviderProjects: vi.fn(),
  linkVaultToProject: vi.fn(),
  getSyncStatus: vi.fn(),
  getSyncDiff: vi.fn(),
  getSyncPreview: vi.fn().mockResolvedValue({ toCreate: [], toUpdate: [], toDelete: [], toSkip: [] }),
  executeSync: vi
    .fn()
    .mockResolvedValue({ status: 'success', created: 1, updated: 0, deleted: 0, skipped: 0 }),
}));

vi.mock('../../src/services', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test-agent' }),
  detectPlatform: vi.fn().mockReturnValue('cli'),
}));

vi.mock('../../src/config/plans', () => ({
  canConnectProvider: vi.fn().mockReturnValue({ allowed: true }),
}));

const NONCE_COOKIE = 'keyway_provider_oauth_nonce';
const SESSION_COOKIE = 'keyway_session';

const otherUser = {
  ...mockUser,
  id: 'other-user-id-456',
  forgeUserId: '99999',
  username: 'someone-else',
};

/** The dashboard session cookie (a Keyway JWT) of a user. */
function sessionFor(user: { id: string; forgeType: 'github'; forgeUserId: string; username: string }) {
  return generateKeywayToken({
    userId: user.id,
    forgeType: user.forgeType,
    forgeUserId: user.forgeUserId,
    username: user.username,
  });
}

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function findCookie(response: InjectResponse, name: string) {
  return (response.cookies as Array<Record<string, any>>).find((c) => c.name === name);
}

function stateFromLocation(response: InjectResponse): string {
  const state = new URL(response.headers.location as string).searchParams.get('state');
  expect(state).toBeTruthy();
  return state!;
}

describe('Provider OAuth security', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider.getAuthorizationUrl.mockReturnValue({
      url: 'https://vercel.com/integrations/keyway/new?state=',
    });
    provider.exchangeCodeForToken.mockResolvedValue({ accessToken: 'vercel-access-token' });
    provider.getUser.mockResolvedValue({ id: 'vercel-user-1', username: 'victim-on-vercel' });
    const { db } = await import('../../src/db');
    // mockReset also drops values queued with mockResolvedValueOnce by a previous test
    (db.query.users.findFirst as any).mockReset().mockResolvedValue(mockUser);
    const { getUserRoleWithApp } = await import('../../src/utils/github');
    (getUserRoleWithApp as any).mockReset().mockResolvedValue('admin');
    const { requireSyncPermission, requireEnvironmentPermission } = await import(
      '../../src/utils/permissions'
    );
    (requireSyncPermission as any).mockReset().mockResolvedValue(undefined);
    (requireEnvironmentPermission as any).mockReset().mockResolvedValue(undefined);
    const { canConnectProvider } = await import('../../src/config/plans');
    (canConnectProvider as any).mockReturnValue({ allowed: true });

    // No form parser and no cookie plugin at the root: the routes bring what they need
    app = Fastify({ logger: false });
    await app.register(cookie);
    const { integrationsRoutes } = await import('../../src/api/v1/routes/integrations.routes');
    await app.register(integrationsRoutes, { prefix: '/v1/integrations' });
    await app.ready();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  async function authorizeWithBearer(providerName = 'vercel') {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/integrations/${providerName}/authorize`,
      headers: { authorization: `Bearer ${VALID_JWT}` },
    });
    expect(response.statusCode).toBe(302);
    return response;
  }

  async function requestTicket(providerName = 'vercel'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/integrations/${providerName}/authorize-ticket`,
      headers: { authorization: `Bearer ${VALID_JWT}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).data.url as string;
  }

  function pathAndQuery(url: string): string {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  }

  describe('provider OAuth state bound to the browser', () => {
    it('GET /authorize sets an httpOnly nonce cookie scoped to the provider callback', async () => {
      const response = await authorizeWithBearer();

      const nonce = findCookie(response, NONCE_COOKIE);
      expect(nonce).toBeDefined();
      expect(nonce!.httpOnly).toBe(true);
      expect(String(nonce!.sameSite).toLowerCase()).toBe('lax');
      expect(nonce!.path).toBe('/v1/integrations/vercel/callback');
      expect(nonce!.maxAge).toBeGreaterThan(0);
      expect(nonce!.maxAge).toBeLessThanOrEqual(600);
      expect(verifyState(stateFromLocation(response))!.nonceHash).toBe(hashStateNonce(nonce!.value));
    });

    it('callback without the nonce cookie connects nothing', async () => {
      const { createConnection } = await import('../../src/services/integration.service');
      const state = stateFromLocation(await authorizeWithBearer());

      // The victim's browser comes back with the attacker's state
      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/callback?code=victim-code&state=${encodeURIComponent(state)}`,
      });

      expect(response.body).toContain('Connection Failed');
      expect(provider.exchangeCodeForToken).not.toHaveBeenCalled();
      expect(createConnection).not.toHaveBeenCalled();
    });

    it('callback with the nonce of another flow connects nothing', async () => {
      const { createConnection } = await import('../../src/services/integration.service');
      const state = stateFromLocation(await authorizeWithBearer());
      const otherNonce = findCookie(await authorizeWithBearer(), NONCE_COOKIE)!.value;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/callback?code=victim-code&state=${encodeURIComponent(state)}`,
        cookies: { [NONCE_COOKIE]: otherNonce },
      });

      expect(response.body).toContain('Connection Failed');
      expect(createConnection).not.toHaveBeenCalled();
    });

    it('callback with the matching nonce connects the provider and clears the cookie', async () => {
      const { createConnection } = await import('../../src/services/integration.service');
      const start = await authorizeWithBearer();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/callback?code=good-code&state=${encodeURIComponent(stateFromLocation(start))}`,
        cookies: { [NONCE_COOKIE]: findCookie(start, NONCE_COOKIE)!.value },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Connected successfully');
      expect(createConnection).toHaveBeenCalledWith(
        mockUser.id,
        'vercel',
        'vercel-access-token',
        expect.anything(),
        undefined,
        undefined,
        undefined
      );
      expect(findCookie(response, NONCE_COOKIE)?.value).toBe('');
    });
  });

  describe('single-use ticket instead of the JWT in the URL', () => {
    it('POST /authorize-ticket returns an authorize URL with a ticket and without the JWT', async () => {
      const url = await requestTicket();

      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/v1/integrations/vercel/authorize');
      expect(parsed.searchParams.get('ticket')).toBeTruthy();
      expect(parsed.searchParams.has('token')).toBe(false);
      expect(url).not.toContain(VALID_JWT);
    });

    it('POST /authorize-ticket requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/vercel/authorize-ticket',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('POST /authorize-ticket returns 404 for an unknown provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/unknown/authorize-ticket',
        headers: { authorization: `Bearer ${VALID_JWT}` },
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /authorize with the ticket starts the flow for the ticket owner', async () => {
      const { createConnection } = await import('../../src/services/integration.service');
      const url = await requestTicket();

      const start = await app.inject({
        method: 'GET',
        url: pathAndQuery(url),
        cookies: { [SESSION_COOKIE]: sessionFor(mockUser) },
      });
      expect(start.statusCode).toBe(302);
      expect(start.headers.location).toContain('vercel.com');

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/callback?code=good-code&state=${encodeURIComponent(stateFromLocation(start))}`,
        cookies: { [NONCE_COOKIE]: findCookie(start, NONCE_COOKIE)!.value },
      });
      expect(callback.body).toContain('Connected successfully');
      expect((createConnection as any).mock.calls[0][0]).toBe(mockUser.id);
    });

    it('a ticket works once', async () => {
      const url = await requestTicket();
      const cookies = { [SESSION_COOKIE]: sessionFor(mockUser) };

      const first = await app.inject({ method: 'GET', url: pathAndQuery(url), cookies });
      expect(first.statusCode).toBe(302);
      expect(first.headers.location).toContain('vercel.com');
      const replay = await app.inject({ method: 'GET', url: pathAndQuery(url), cookies });
      expect(replay.statusCode).toBe(401);
      expect(replay.headers.location).toBeUndefined();
    });

    it('a ticket survives a web-login round trip but expires after 10 minutes', async () => {
      const url = await requestTicket();
      const start = Date.now();
      vi.useFakeTimers({ toFake: ['Date'] });

      // 5 minutes later (e.g. back from the GitHub sign-in): still valid, so the
      // browser without a session is sent to the web login, not told it expired
      vi.setSystemTime(start + 5 * 60_000);
      const stillValid = await app.inject({ method: 'GET', url: pathAndQuery(url) });
      expect(stillValid.statusCode).toBe(302);

      vi.setSystemTime(start + 10 * 60_000 + 1_000);
      const expired = await app.inject({ method: 'GET', url: pathAndQuery(url) });
      expect(expired.statusCode).toBe(401);
    });

    it('a ticket is only valid for its provider', async () => {
      const ticket = new URL(await requestTicket('netlify')).searchParams.get('ticket')!;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/authorize?ticket=${encodeURIComponent(ticket)}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('a forged or foreign signed value is not a ticket', async () => {
      const ticket = new URL(await requestTicket()).searchParams.get('ticket')!;
      const [payload] = ticket.split('.');
      const oauthState = signState({
        type: 'provider_oauth',
        provider: 'vercel',
        forgeType: 'github',
        forgeUserId: mockUser.forgeUserId,
      });

      for (const forged of [`${payload}.forged-signature`, oauthState, 'garbage']) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/integrations/vercel/authorize?ticket=${encodeURIComponent(forged)}`,
        });
        expect(response.statusCode, forged).toBe(401);
      }
    });

    it('GET /authorize refuses the legacy ?token= of older CLIs and asks to upgrade', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/authorize?token=${encodeURIComponent(VALID_JWT)}`,
        cookies: { [SESSION_COOKIE]: sessionFor(mockUser) },
      });

      expect(String(response.headers.location ?? '')).not.toContain('vercel.com');
      expect(String(response.headers['set-cookie'] ?? '')).not.toContain('nonce');
      expect(response.statusCode).toBe(410);
      expect(response.body).toMatch(/0\.7\.0/);
      expect(response.body).not.toContain(VALID_JWT);
    });

    it('?token= is not accepted by the other routes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/integrations/vercel/authorize-ticket?token=${encodeURIComponent(VALID_JWT)}`,
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("a ticket or legacy token only starts the flow in its owner's browser", () => {
    // The attack: the attacker gets their own ticket (or uses their own JWT as ?token=) and
    // sends the /authorize link to a victim. Without this check the victim's browser gets a
    // valid nonce cookie while the signed state names the attacker, so the victim's provider
    // token lands on the attacker's Keyway account.

    function expectNoProviderFlow(response: InjectResponse) {
      expect(String(response.headers.location ?? '')).not.toContain('vercel.com');
      expect(findCookie(response, NONCE_COOKIE)).toBeUndefined();
    }

    it('a ticket opened without a Keyway session goes through the web login and comes back', async () => {
      const url = await requestTicket();

      const response = await app.inject({ method: 'GET', url: pathAndQuery(url) });

      expectNoProviderFlow(response);
      expect(response.statusCode).toBe(302);
      const login = new URL(response.headers.location as string, 'https://api.keyway.test');
      expect(login.pathname).toBe('/v1/auth/github/start');
      const returnTo = login.searchParams.get('redirect_uri')!;
      expect(returnTo.startsWith('/v1/integrations/vercel/authorize?ticket=')).toBe(true);

      // The ticket was not burned: signed in, the same browser comes back and starts the flow
      const back = await app.inject({
        method: 'GET',
        url: returnTo,
        cookies: { [SESSION_COOKIE]: sessionFor(mockUser) },
      });
      expect(back.statusCode).toBe(302);
      expect(back.headers.location).toContain('vercel.com');
    });

    it('a ticket opened in a browser signed in as someone else starts nothing and keeps the ticket', async () => {
      const { db } = await import('../../src/db');
      const url = await requestTicket();
      (db.query.users.findFirst as any).mockResolvedValueOnce(otherUser);

      const victim = await app.inject({
        method: 'GET',
        url: pathAndQuery(url),
        cookies: { [SESSION_COOKIE]: sessionFor(otherUser) },
      });

      expectNoProviderFlow(victim);
      expect(victim.statusCode).toBe(403);
      expect(victim.headers['content-type']).toContain('text/html');
      expect(victim.body).toContain(`@${mockUser.username}`);

      // The owner can still use it
      const owner = await app.inject({
        method: 'GET',
        url: pathAndQuery(url),
        cookies: { [SESSION_COOKIE]: sessionFor(mockUser) },
      });
      expect(owner.headers.location).toContain('vercel.com');
    });

    it('back from the web login still without a session, the browser gets a page, not another login round', async () => {
      const url = await requestTicket();
      const first = await app.inject({ method: 'GET', url: pathAndQuery(url) });
      const returnTo = new URL(first.headers.location as string, 'https://api.keyway.test').searchParams.get(
        'redirect_uri'
      )!;

      // e.g. cookies blocked: no loop through GitHub
      const back = await app.inject({ method: 'GET', url: returnTo });

      expectNoProviderFlow(back);
      expect(back.headers.location).toBeUndefined();
      expect(back.statusCode).toBe(401);
      expect(back.body).toContain(`@${mockUser.username}`);
    });

    it('an invalid session cookie counts as no session', async () => {
      const url = await requestTicket();

      const response = await app.inject({
        method: 'GET',
        url: pathAndQuery(url),
        cookies: { [SESSION_COOKIE]: 'not-a-jwt' },
      });

      expectNoProviderFlow(response);
      expect(response.headers.location).toMatch(/^\/v1\/auth\/github\/start\?/);
    });

    it('a session whose user no longer exists counts as no session', async () => {
      const { db } = await import('../../src/db');
      const url = await requestTicket();
      (db.query.users.findFirst as any).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: pathAndQuery(url),
        cookies: { [SESSION_COOKIE]: sessionFor(mockUser) },
      });

      expectNoProviderFlow(response);
      expect(response.headers.location).toMatch(/^\/v1\/auth\/github\/start\?/);
    });

    it('the legacy ?token= without a Keyway session starts nothing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/authorize?token=${encodeURIComponent(VALID_JWT)}`,
      });

      expectNoProviderFlow(response);
      // Never through the login round trip: that would put the long-lived token in the state
      expect(response.headers.location).toBeUndefined();
      expect(response.statusCode).toBe(410);
    });

    it('the legacy ?token= in a browser signed in as someone else starts nothing', async () => {
      const { db } = await import('../../src/db');
      (db.query.users.findFirst as any).mockResolvedValueOnce(otherUser);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/authorize?token=${encodeURIComponent(VALID_JWT)}`,
        cookies: { [SESSION_COOKIE]: sessionFor(otherUser) },
      });

      expectNoProviderFlow(response);
      expect(response.statusCode).toBe(410);
    });

    it('escapes the usernames it prints', async () => {
      const { db } = await import('../../src/db');
      const url = await requestTicket();
      const evil = { ...otherUser, username: '<img src=x onerror=alert(1)>' };
      (db.query.users.findFirst as any).mockResolvedValueOnce(evil);

      const response = await app.inject({
        method: 'GET',
        url: pathAndQuery(url),
        cookies: { [SESSION_COOKIE]: sessionFor(evil) },
      });

      expect(response.body).not.toContain('<img src=x');
      expect(response.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('a Bearer request (not from a browser) needs no session', async () => {
      const response = await authorizeWithBearer();
      expect(response.headers.location).toContain('vercel.com');
    });
  });

  describe('sync routes enforce the environment permission with the role already checked', () => {
    // A read collaborator whose second role lookup would fail (GitHub rate limit, outage):
    // the environment check must not be skipped
    const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
    const VAULT_PATH = '/v1/integrations/vaults/testuser/test-repo';

    beforeEach(async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      let lookups = 0;
      (getUserRoleWithApp as any).mockImplementation(async () => (++lookups === 1 ? 'read' : null));
      const { ForbiddenError } = await import('../../src/lib');
      const { requireSyncPermission, requireEnvironmentPermission } = await import(
        '../../src/utils/permissions'
      );
      (requireSyncPermission as any).mockImplementation(
        async (_vaultId: string, keywayEnv: string, _providerEnv: string, _dir: string, _userId: string, role: string) => {
          if (role !== 'admin' && keywayEnv === 'production') {
            throw new ForbiddenError('production is protected');
          }
        }
      );
      (requireEnvironmentPermission as any).mockImplementation(
        async (_vaultId: string, env: string, _userId: string, role: string) => {
          if (role !== 'admin' && env === 'production') {
            throw new ForbiddenError('production is protected');
          }
        }
      );
    });

    async function expectRoleCheckedOnce() {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      expect(getUserRoleWithApp).toHaveBeenCalledTimes(1);
      expect(getUserRoleWithApp).toHaveBeenCalledWith(
        'testuser/test-repo',
        expect.objectContaining({ username: mockUser.username, forgeUserId: mockUser.forgeUserId }),
        { expectedRepoId: '999888' }
      );
    }

    it('POST /sync: a read collaborator cannot push production secrets', async () => {
      const { executeSync } = await import('../../src/services/integration.service');
      const { requireSyncPermission } = await import('../../src/utils/permissions');

      const response = await app.inject({
        method: 'POST',
        url: `${VAULT_PATH}/sync`,
        headers: { authorization: `Bearer ${VALID_JWT}` },
        payload: {
          connectionId: CONNECTION_ID,
          projectId: 'prj_1',
          keywayEnvironment: 'production',
          providerEnvironment: 'production',
          direction: 'push',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(executeSync).not.toHaveBeenCalled();
      expect((requireSyncPermission as any).mock.calls[0][5]).toBe('read');
      await expectRoleCheckedOnce();
    });

    it('GET /sync/preview: a read collaborator cannot preview a production push', async () => {
      const { getSyncPreview } = await import('../../src/services/integration.service');

      const response = await app.inject({
        method: 'GET',
        url: `${VAULT_PATH}/sync/preview?connectionId=${CONNECTION_ID}&projectId=prj_1&keywayEnvironment=production`,
        headers: { authorization: `Bearer ${VALID_JWT}` },
      });

      expect(response.statusCode).toBe(403);
      expect(getSyncPreview).not.toHaveBeenCalled();
      await expectRoleCheckedOnce();
    });

    it('GET /sync/diff: a read collaborator cannot diff production secrets', async () => {
      const { getSyncDiff } = await import('../../src/services/integration.service');
      const { requireEnvironmentPermission } = await import('../../src/utils/permissions');

      const response = await app.inject({
        method: 'GET',
        url: `${VAULT_PATH}/sync/diff?connectionId=${CONNECTION_ID}&projectId=prj_1&keywayEnvironment=production`,
        headers: { authorization: `Bearer ${VALID_JWT}` },
      });

      expect(response.statusCode).toBe(403);
      expect(getSyncDiff).not.toHaveBeenCalled();
      expect((requireEnvironmentPermission as any).mock.calls[0][3]).toBe('read');
      await expectRoleCheckedOnce();
    });

    it('a caller without any role on the repository gets 403', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      const { executeSync } = await import('../../src/services/integration.service');
      (getUserRoleWithApp as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: `${VAULT_PATH}/sync`,
        headers: { authorization: `Bearer ${VALID_JWT}` },
        payload: { connectionId: CONNECTION_ID, projectId: 'prj_1', direction: 'push' },
      });

      expect(response.statusCode).toBe(403);
      expect(executeSync).not.toHaveBeenCalled();
    });
  });

  describe('escaped HTML and no form bodies', () => {
    it('escapes the provider error description', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vercel/callback',
        query: { error: 'access_denied', error_description: '<script>alert(1)</script>' },
      });

      expect(response.body).toContain('Authorization Denied');
      expect(response.body).not.toContain('<script>alert(1)</script>');
      expect(response.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes the provider username on the success page', async () => {
      provider.getUser.mockResolvedValue({ id: 'v-1', username: '<img src=x onerror=alert(1)>' });
      const start = await authorizeWithBearer();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/callback?code=good-code&state=${encodeURIComponent(stateFromLocation(start))}`,
        cookies: { [NONCE_COOKIE]: findCookie(start, NONCE_COOKIE)!.value },
      });

      expect(response.body).toContain('Connected successfully');
      expect(response.body).not.toContain('<img src=x');
      expect(response.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('escapes the plan limit reason but keeps the upgrade link', async () => {
      const start = await authorizeWithBearer();
      const { canConnectProvider } = await import('../../src/config/plans');
      (canConnectProvider as any).mockReturnValue({ allowed: false, reason: '<b>limit</b>' });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/vercel/callback?code=good-code&state=${encodeURIComponent(stateFromLocation(start))}`,
        cookies: { [NONCE_COOKIE]: findCookie(start, NONCE_COOKIE)!.value },
      });

      expect(response.body).toContain('Provider Limit Reached');
      expect(response.body).not.toContain('<b>limit</b>');
      expect(response.body).toMatch(/<a href="[^"]*\/upgrade">Upgrade your plan<\/a>/);
    });

    it('rejects an HTML form body with 415', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/railway/connect',
        payload: 'token=x',
        headers: {
          authorization: `Bearer ${VALID_JWT}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
      });
      expect(response.statusCode).toBe(415);
    });
  });
});
