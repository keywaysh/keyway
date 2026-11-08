import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Live GitHub org-admin / membership checks (org identity binding).
 *
 * `organization_members.org_role` is a mirror of GitHub and GitHub sends no
 * webhook on an admin -> member demotion, so authorization must read the role
 * live via the App installation token and fail closed when it can't.
 *
 * The installation (and so the token) must belong to the GitHub org the Keyway
 * row was created for, matched by GitHub's IMMUTABLE org id: GitHub lets a
 * renamed org's old login be re-registered by anyone, so a lookup by login
 * would hand the old org's Keyway data to whoever reclaimed the name.
 */

const mocks = vi.hoisted(() => ({
  installationFindFirst: vi.fn(),
  getOrgMembership: vi.fn(),
  getInstallationToken: vi.fn(),
  findOrgInstallationViaGitHubAPI: vi.fn(),
  syncInstallationFromAPI: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

vi.mock('../src/config', () => ({
  config: { github: { apiBaseUrl: 'https://api.github.com' } },
}));

vi.mock('../src/db', () => ({
  db: { query: { vcsAppInstallations: { findFirst: mocks.installationFindFirst } } },
  vcsAppInstallations: {
    accountId: 'accountId',
    accountLogin: 'accountLogin',
    accountType: 'accountType',
    status: 'status',
  },
}));

vi.mock('../src/utils/github', () => ({
  getOrgMembership: mocks.getOrgMembership,
}));

vi.mock('../src/services/github-app.service', () => ({
  getInstallationToken: mocks.getInstallationToken,
  findOrgInstallationViaGitHubAPI: mocks.findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI: mocks.syncInstallationFromAPI,
}));

import {
  getLiveOrgRole,
  isLiveOrgAdmin,
  getOrgInstallationToken,
  readLiveOrgMembership,
} from '../src/utils/orgAdmin';

/** The Keyway organization row: login can change, forgeOrgId never does. */
const acme = { login: 'acme', forgeOrgId: '111' };
const acmeInstallation = { installationId: 42, accountId: 111, accountLogin: 'acme' };

/** The signed-in user: the login only addresses her on GitHub, the id is who she is. */
const alice = { username: 'alice', forgeUserId: '501' };
const mallory = { username: 'mallory', forgeUserId: '666' };

function membership(
  role: 'admin' | 'member',
  state: 'active' | 'pending',
  orgId = 111,
  user: { id: number; login: string } | null = { id: 501, login: 'alice' }
) {
  return { role, state, organization: { id: orgId, login: 'acme', avatar_url: '' }, user };
}

/**
 * Stub for the status read that tells "not a member" (404) from "can't tell",
 * and for the account lookup (GET /users/:login) behind a 404. By default the
 * login still belongs to the signed-in user (id 501).
 */
function stubMembershipStatus(
  status: number,
  headers: Record<string, string> = {},
  loginOwner: { status: number; id?: number } = { status: 200, id: 501 }
) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) =>
    String(url).includes('/users/')
      ? new Response(JSON.stringify(loginOwner.id ? { id: loginOwner.id } : {}), {
          status: loginOwner.status,
        })
      : new Response('{}', { status, headers })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.installationFindFirst.mockResolvedValue(acmeInstallation);
  mocks.getInstallationToken.mockResolvedValue('install-token');
  mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('live org admin check', () => {
  it('reads the role with the installation token and the session login', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active'));

    expect(await isLiveOrgAdmin(acme, alice)).toBe(true);
    expect(mocks.getInstallationToken).toHaveBeenCalledWith(42);
    expect(mocks.getOrgMembership).toHaveBeenCalledWith('install-token', 'acme', 'alice');
  });

  it('maps a GitHub member to a Keyway member (demoted admin is not an admin)', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('member', 'active'));

    expect(await getLiveOrgRole(acme, alice)).toBe('member');
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
  });

  it('is not admin when the membership is pending', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'pending'));
    expect(await getLiveOrgRole(acme, alice)).toBeNull();
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
  });

  it('is not admin when the caller left the org', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(404);
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
  });

  it('fails closed when the App is not installed on the org', async () => {
    mocks.installationFindFirst.mockResolvedValue(undefined);
    mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);

    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
    expect(mocks.getOrgMembership).not.toHaveBeenCalled();
  });

  it('falls back to the GitHub API to find the installation', async () => {
    const apiInstallation = { installationId: 77, accountId: 111, accountLogin: 'acme' };
    mocks.installationFindFirst.mockResolvedValue(undefined);
    mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(apiInstallation);
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active'));

    expect(await isLiveOrgAdmin(acme, alice)).toBe(true);
    expect(mocks.syncInstallationFromAPI).toHaveBeenCalledWith(apiInstallation);
    expect(mocks.getInstallationToken).toHaveBeenCalledWith(77);
  });

  it('fails closed when the installation token cannot be minted', async () => {
    mocks.getInstallationToken.mockRejectedValue(new Error('GitHub down'));
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
  });

  it('fails closed when GitHub errors on the membership read', async () => {
    mocks.getOrgMembership.mockRejectedValue(new Error('GitHub down'));
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
  });

  it('fails closed when the installation lookup itself throws', async () => {
    mocks.installationFindFirst.mockRejectedValue(new Error('db down'));
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
  });
});

describe('org identity is bound to the immutable GitHub org id', () => {
  it('looks the DB installation up by account id, not by login', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active'));

    await isLiveOrgAdmin(acme, alice);

    const where = JSON.stringify(mocks.installationFindFirst.mock.calls[0][0].where);
    expect(where).toContain(JSON.stringify({ eq: ['accountId', 111] }));
    expect(where).not.toContain('accountLogin');
  });

  it('refuses a reclaimed login: the API installation for the name belongs to another org', async () => {
    // acme renamed itself and uninstalled Keyway; mallory registered "acme" and
    // installed Keyway on it. Her installation is for a different account id.
    mocks.installationFindFirst.mockResolvedValue(undefined);
    mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue({
      installationId: 666,
      accountId: 999,
      accountLogin: 'acme',
    });
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active', 999, { id: 666, login: 'mallory' }));

    expect(await isLiveOrgAdmin(acme, mallory)).toBe(false);
    expect(await getOrgInstallationToken(acme)).toBeNull();
    expect(mocks.getInstallationToken).not.toHaveBeenCalled();
    expect(mocks.getOrgMembership).not.toHaveBeenCalled();
    // Not cached as "the" installation for this org either.
    expect(mocks.syncInstallationFromAPI).not.toHaveBeenCalled();
  });

  it('refuses a DB installation row whose account id does not match', async () => {
    mocks.installationFindFirst.mockResolvedValue({ installationId: 666, accountId: 999 });
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active', 999, { id: 666, login: 'mallory' }));

    expect(await isLiveOrgAdmin(acme, mallory)).toBe(false);
    expect(mocks.getInstallationToken).not.toHaveBeenCalled();
  });

  it('refuses a membership GitHub reports for a different org id', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active', 999, { id: 666, login: 'mallory' }));

    expect(await isLiveOrgAdmin(acme, mallory)).toBe(false);
  });

  it('cannot verify an org row with a malformed forge id', async () => {
    expect(await isLiveOrgAdmin({ login: 'acme', forgeOrgId: 'not-a-number' }, alice)).toBe(false);
    expect(mocks.installationFindFirst).not.toHaveBeenCalled();
  });
});

describe('readLiveOrgMembership: active / not a member / cannot verify', () => {
  it('active member → role', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active'));
    expect(await readLiveOrgMembership(acme, alice)).toEqual({ status: 'active', role: 'owner' });
  });

  it('pending invitation → definitely not a member', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('member', 'pending'));
    expect(await readLiveOrgMembership(acme, alice)).toEqual({ status: 'not_member' });
  });

  it('GitHub 404 → definitely not a member (status read uses the installation token)', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    const fetchMock = stubMembershipStatus(404);

    expect(await readLiveOrgMembership(acme, alice)).toEqual({ status: 'not_member' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/orgs/acme/memberships/alice');
    expect(init.headers.Authorization).toBe('Bearer install-token');
    // ...and the login was confirmed to still be hers before saying "not a member"
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/users/alice');
  });

  it('GitHub 403 → cannot verify: the App lacks the Members permission', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(403);
    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'missing_permission',
    });
  });

  it('GitHub 403 rate limit → cannot verify: GitHub unavailable', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(403, { 'x-ratelimit-remaining': '0' });
    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'unavailable',
    });
  });

  it('GitHub 5xx → cannot verify: GitHub unavailable', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(502);
    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'unavailable',
    });
  });

  it('network error → cannot verify: GitHub unavailable', async () => {
    mocks.getOrgMembership.mockRejectedValue(new Error('ECONNRESET'));
    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'unavailable',
    });
  });

  it('no installation bound to the org id → cannot verify: App not installed', async () => {
    mocks.installationFindFirst.mockResolvedValue(undefined);
    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'app_not_installed',
    });
  });

  it('token mint failure → cannot verify: GitHub unavailable', async () => {
    mocks.getInstallationToken.mockRejectedValue(new Error('GitHub down'));
    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'unavailable',
    });
  });
});

/**
 * GitHub lets an account release its login and someone else register it. Alice
 * (id 501) signed in to Keyway as "alice", then renamed on GitHub; Bob (id 2002)
 * registered "alice". Keyway still addresses Alice by "alice", so GitHub answers
 * about Bob. Bob's membership must never count as Alice's, and Alice's cached
 * membership must not be dropped because of it: "cannot verify", never "not a member".
 */
describe('readLiveOrgMembership: login released and re-registered', () => {
  const bob = { id: 2002, login: 'alice' };

  it("does not take the new holder's admin membership for the signed-in user", async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active', 111, bob));

    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'account_mismatch',
    });
    expect(await isLiveOrgAdmin(acme, alice)).toBe(false);
    expect(await getLiveOrgRole(acme, alice)).toBeNull();
  });

  it("does not report the user as gone because of the new holder's pending invitation", async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('member', 'pending', 111, bob));

    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'account_mismatch',
    });
  });

  it('refuses a membership that does not say whose it is', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active', 111, null));

    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'account_mismatch',
    });
  });

  it('a 404 for a login now held by someone else is not "not a member"', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(404, {}, { status: 200, id: 2002 });

    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'account_mismatch',
    });
  });

  it('a 404 for a released login nobody holds is not "not a member"', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(404, {}, { status: 404 });

    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'account_mismatch',
    });
  });

  it('a 404 whose login owner cannot be read is "cannot verify: unavailable"', async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubMembershipStatus(404, {}, { status: 502 });

    expect(await readLiveOrgMembership(acme, alice)).toEqual({
      status: 'unverifiable',
      reason: 'unavailable',
    });
  });

  it('grants nothing to an account without a GitHub user id, without asking GitHub', async () => {
    for (const forgeUserId of ['', 'abc', '0']) {
      expect(await readLiveOrgMembership(acme, { username: 'alice', forgeUserId })).toEqual({
        status: 'unverifiable',
        reason: 'account_mismatch',
      });
    }
    expect(
      await isLiveOrgAdmin(acme, { forgeType: 'gitlab', username: 'alice', forgeUserId: '501' })
    ).toBe(false);
    expect(mocks.getOrgMembership).not.toHaveBeenCalled();
  });
});

describe('readLiveOrgMembership: a bare login is never enough', () => {
  it('refuses a caller identified only by login (login-reuse unsafe)', async () => {
    mocks.getOrgMembership.mockResolvedValue(membership('admin', 'active', 111, null));
    // A JS caller (or a stale type cast) passing a login instead of an account
    expect(await readLiveOrgMembership(acme, 'alice' as never)).toEqual({
      status: 'unverifiable',
      reason: 'account_mismatch',
    });
    expect(mocks.getOrgMembership).not.toHaveBeenCalled();
  });
});
