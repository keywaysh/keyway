import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import cookie from '@fastify/cookie';

vi.hoisted(() => {
  process.env.ALLOWED_ORIGINS = 'https://app.keyway.sh';
});

vi.mock('../src/db', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      vaults: { findFirst: vi.fn() },
      apiKeys: { findFirst: vi.fn() },
    },
    update: vi.fn(),
  },
  users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
  vaults: { repoFullName: 'repoFullName' },
  apiKeys: { keyHash: 'keyHash', revokedAt: 'revokedAt' },
}));

vi.mock('../src/utils/github', () => ({
  getUserFromToken: vi.fn(),
  getUserRoleWithApp: vi.fn(),
  getRepoInfoWithApp: vi.fn(),
}));

vi.mock('../src/utils/tokenEncryption', () => ({
  decryptAccessToken: vi.fn().mockResolvedValue('gho_stored_user_token'),
}));

vi.mock('../src/utils/permissions', () => ({
  hasEnvironmentPermission: vi.fn().mockResolvedValue(true),
  resolveEffectivePermission: vi.fn().mockResolvedValue(true),
}));

import { createTestApp, closeTestApp } from './helpers/testApp';
import {
  authenticateGitHub,
  requireAdminAccess,
  requireAdminOrOwnerAccess,
  requireEnvironmentAccess,
} from '../src/middleware/auth';
import { ForbiddenError } from '../src/lib';
import { generateKeywayToken } from '../src/utils/jwt';
import { db } from '../src/db';
import { getRepoInfoWithApp, getUserFromToken, getUserRoleWithApp } from '../src/utils/github';
import { hasEnvironmentPermission, resolveEffectivePermission } from '../src/utils/permissions';

const dbUser = {
  id: 'user-1',
  forgeType: 'github',
  forgeUserId: '42',
  username: 'alice',
  email: null,
  avatarUrl: null,
  encryptedAccessToken: 'x',
  accessTokenIv: 'x',
  accessTokenAuthTag: 'x',
  tokenEncryptionVersion: 1,
};

const validJwt = () =>
  generateKeywayToken({ userId: 'user-1', forgeType: 'github', forgeUserId: '42', username: 'alice' });

describe('auth middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    await app.register(cookie);
    app.get('/me', { preHandler: [authenticateGitHub] }, async (req) => ({
      username: req.vcsUser?.username,
    }));
    app.post('/mutate', { preHandler: [authenticateGitHub] }, async () => ({ ok: true }));
    app.get(
      '/pull',
      { preHandler: [authenticateGitHub, requireEnvironmentAccess('read')] },
      async () => ({ ok: true })
    );
    app.get(
      '/vaults/:owner/:repo/collaborators',
      { preHandler: [authenticateGitHub, requireAdminAccess] },
      async () => ({ ok: true })
    );
    app.delete(
      '/vaults/:owner/:repo',
      { preHandler: [authenticateGitHub, requireAdminOrOwnerAccess] },
      async () => ({ ok: true })
    );
    await app.ready();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (db.query.users.findFirst as any).mockResolvedValue(dbUser);
  });

  describe('authenticateGitHub', () => {
    it('accepts a Bearer Keyway JWT', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${validJwt()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ username: 'alice' });
    });

    it('ignores a token passed in the query string', async () => {
      const res = await app.inject({ method: 'GET', url: `/me?token=${validJwt()}` });
      expect(res.statusCode).toBe(401);
    });

    it.each(['ghp_abc123', 'github_pat_11ABC_def', 'gho_abc', 'ghu_abc', 'ghs_abc'])(
      'rejects a raw GitHub token (%s) with an actionable message',
      async (token) => {
        const res = await app.inject({
          method: 'GET',
          url: '/me',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().detail).toMatch(/GitHub tokens are not accepted/);
        expect(getUserFromToken).not.toHaveBeenCalled();
      }
    );

    it('never treats an expired Keyway JWT as a GitHub token', async () => {
      (getUserFromToken as any).mockResolvedValue({
        forgeUserId: '7',
        username: 'mallory',
        email: null,
        avatarUrl: null,
      });
      const expired = jwt.sign(
        { userId: 'user-1', forgeType: 'github', forgeUserId: '42', username: 'alice' },
        process.env.JWT_SECRET!,
        { algorithm: 'HS256', issuer: 'keyway-api', subject: 'user-1', expiresIn: -10 }
      );

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${expired}` },
      });

      expect(res.statusCode).toBe(401);
      expect(getUserFromToken).not.toHaveBeenCalled();
    });

    describe('CSRF protection for cookie sessions', () => {
      const cookie = () => `keyway_session=${validJwt()}`;

      it('rejects a cookie-authenticated POST from a non-allowed origin', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/mutate',
          headers: { cookie: cookie(), origin: 'https://api.keyway.sh' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('rejects a cookie-authenticated POST without an Origin header', async () => {
        const res = await app.inject({ method: 'POST', url: '/mutate', headers: { cookie: cookie() } });
        expect(res.statusCode).toBe(403);
      });

      it('allows a cookie-authenticated POST from the dashboard origin', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/mutate',
          headers: { cookie: cookie(), origin: 'https://app.keyway.sh' },
        });
        expect(res.statusCode).toBe(200);
      });

      it('allows a cookie-authenticated GET from anywhere', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/me',
          headers: { cookie: cookie(), origin: 'https://evil.example' },
        });
        expect(res.statusCode).toBe(200);
      });

      it('does not require an Origin for Bearer-authenticated POSTs (CLI, CI)', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/mutate',
          headers: { authorization: `Bearer ${validJwt()}` },
        });
        expect(res.statusCode).toBe(200);
      });
    });
  });

  describe('requireEnvironmentAccess', () => {
    const vault = { id: 'vault-1', repoFullName: 'acme/api', forgeRepoId: '123' };

    it("checks the role against the vault's immutable repo id", async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(vault);
      (getUserRoleWithApp as any).mockResolvedValue('write');

      const res = await app.inject({
        method: 'GET',
        url: '/pull?repo=acme/api&environment=staging',
        headers: { authorization: `Bearer ${validJwt()}` },
      });

      expect(res.statusCode).toBe(200);
      expect(getUserRoleWithApp).toHaveBeenCalledWith('acme/api', 'alice', {
        expectedRepoId: '123',
      });
    });

    it('denies access when the caller has no Keyway user row', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(vault);
      (getUserRoleWithApp as any).mockResolvedValue('read');
      (db.query.users.findFirst as any)
        .mockResolvedValueOnce(dbUser) // authenticateGitHub (JWT → user by id)
        .mockResolvedValueOnce(undefined); // requireEnvironmentAccess (user by forge id)

      const res = await app.inject({
        method: 'GET',
        url: '/pull?repo=acme/api&environment=staging',
        headers: { authorization: `Bearer ${validJwt()}` },
      });

      expect(res.statusCode).toBe(403);
      expect(hasEnvironmentPermission).not.toHaveBeenCalled();
      expect(resolveEffectivePermission).not.toHaveBeenCalled();
    });
  });

  describe('requireAdminAccess / requireAdminOrOwnerAccess', () => {
    const auth = () => ({ authorization: `Bearer ${validJwt()}` });

    it("binds the admin check to the vault's immutable repo id", async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue({ id: 'v', forgeRepoId: '123' });
      (getUserRoleWithApp as any).mockResolvedValue('admin');

      const res = await app.inject({
        method: 'GET',
        url: '/vaults/acme/api/collaborators',
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      expect(getUserRoleWithApp).toHaveBeenCalledWith('acme/api', 'alice', {
        expectedRepoId: '123',
      });
    });

    it('does not bind the admin check when no vault exists yet (vault creation)', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(undefined);
      (getUserRoleWithApp as any).mockResolvedValue('admin');

      const res = await app.inject({
        method: 'GET',
        url: '/vaults/acme/new-repo/collaborators',
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      expect(getUserRoleWithApp).toHaveBeenCalledWith('acme/new-repo', 'alice', {
        expectedRepoId: undefined,
      });
    });

    it('owner fallback compares the forge user id, not a reusable username', async () => {
      (getUserRoleWithApp as any).mockRejectedValue(
        new ForbiddenError('GitHub App not installed for acme/api')
      );
      (db.query.vaults.findFirst as any).mockResolvedValue({
        id: 'v',
        forgeRepoId: '123',
        owner: { username: 'alice', forgeType: 'github', forgeUserId: '999' },
      });

      const res = await app.inject({ method: 'DELETE', url: '/vaults/acme/api', headers: auth() });

      expect(res.statusCode).toBe(403);
    });

    const ownedVault = (forgeRepoId: string | null) => ({
      id: 'v',
      forgeRepoId,
      owner: { username: 'alice', forgeType: 'github', forgeUserId: '42' },
    });

    it('lets the vault owner delete a vault whose name now points to another repository', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(ownedVault('123'));
      (getUserRoleWithApp as any).mockResolvedValue(null); // repo id mismatch
      (getRepoInfoWithApp as any).mockResolvedValue({ repoId: '999', fullName: 'acme/api' });

      const res = await app.inject({ method: 'DELETE', url: '/vaults/acme/api', headers: auth() });

      expect(res.statusCode).toBe(200);
    });

    it('does not let a non-admin vault owner delete a vault still bound to the live repo', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(ownedVault('123'));
      (getUserRoleWithApp as any).mockResolvedValue('read');
      (getRepoInfoWithApp as any).mockResolvedValue({ repoId: '123', fullName: 'acme/api' });

      const res = await app.inject({ method: 'DELETE', url: '/vaults/acme/api', headers: auth() });

      expect(res.statusCode).toBe(403);
    });

    it('lets the vault owner delete a vault that is not bound to any repository', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(ownedVault(null));
      (getUserRoleWithApp as any).mockRejectedValue(
        new ForbiddenError('The vault for acme/api is not linked to its GitHub repository yet')
      );

      const res = await app.inject({ method: 'DELETE', url: '/vaults/acme/api', headers: auth() });

      expect(res.statusCode).toBe(200);
    });

    it('owner fallback lets the real vault owner delete an orphaned vault', async () => {
      (getUserRoleWithApp as any).mockRejectedValue(
        new ForbiddenError('GitHub App not installed for acme/api')
      );
      (db.query.vaults.findFirst as any).mockResolvedValue({
        id: 'v',
        forgeRepoId: '123',
        owner: { username: 'alice', forgeType: 'github', forgeUserId: '42' },
      });

      const res = await app.inject({ method: 'DELETE', url: '/vaults/acme/api', headers: auth() });

      expect(res.statusCode).toBe(200);
    });
  });
});
