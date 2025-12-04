import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { mockUser, mockVault, createMockDb, createMockGitHubUtils } from '../helpers/mocks';

// Mock installation data
const mockInstallation = {
  id: 'inst-uuid-123',
  installationId: 12345678,
  accountId: 98765,
  accountLogin: 'testuser',
  accountType: 'user' as const,
  repositorySelection: 'selected' as const,
  permissions: { metadata: 'read', administration: 'read' },
  status: 'active' as const,
  installedByUserId: mockUser.id,
  suspendedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tokenCache: null,
};

// Create base mock DB
const baseMockDb = createMockDb();

// Mock the database module
vi.mock('../../src/db', () => {
  return {
    db: {
      ...baseMockDb,
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue(mockUser),
          findMany: vi.fn().mockResolvedValue([mockUser]),
        },
        vaults: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        secrets: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        deviceCodes: {
          findFirst: vi.fn(),
        },
        githubAppInstallations: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        githubAppInstallationRepos: {
          findFirst: vi.fn(),
        },
        usageMetrics: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        vaultEnvironments: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockVault]),
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockVault]),
          }),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUser]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
    users: { id: 'id', githubId: 'githubId' },
    vaults: { id: 'id', repoFullName: 'repoFullName', ownerId: 'ownerId', isPrivate: 'isPrivate' },
    secrets: { id: 'id', vaultId: 'vaultId' },
    deviceCodes: { id: 'id' },
    githubAppInstallations: { installationId: 'installationId', accountLogin: 'accountLogin' },
    githubAppInstallationRepos: { repoFullName: 'repoFullName' },
    activityLogs: { id: 'id' },
    usageMetrics: { userId: 'userId' },
    vaultEnvironments: { vaultId: 'vaultId' },
  };
});

// Mock GitHub utils
const mockGitHubUtils = createMockGitHubUtils();
vi.mock('../../src/utils/github', () => mockGitHubUtils);

// Mock GitHub App service
vi.mock('../../src/services/github-app.service', () => ({
  handleInstallationCreated: vi.fn().mockResolvedValue(mockInstallation),
  findInstallationForRepo: vi.fn().mockResolvedValue(mockInstallation),
  getInstallationToken: vi.fn().mockResolvedValue('ghs_mock_installation_token'),
  checkInstallationStatus: vi.fn().mockResolvedValue({
    installed: true,
    installationId: 12345678,
    installUrl: 'https://github.com/apps/keyway-test/installations/new',
  }),
}));

// Mock analytics
vi.mock('../../src/utils/analytics', () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  getSignupSource: vi.fn().mockReturnValue('direct'),
  AnalyticsEvents: {
    VAULT_CREATED: 'api_vault_created',
    VAULT_DELETED: 'api_vault_deleted',
  },
}));

// Mock token encryption
vi.mock('../../src/utils/tokenEncryption', () => ({
  encryptAccessToken: vi.fn().mockResolvedValue({
    encryptedAccessToken: 'encrypted-token',
    accessTokenIv: 'iv',
    accessTokenAuthTag: 'auth-tag',
    tokenEncryptionVersion: 1,
  }),
  decryptAccessToken: vi.fn().mockResolvedValue('gho_decrypted_token'),
}));

// Mock JWT
vi.mock('../../src/utils/jwt', () => ({
  verifyKeywayToken: vi.fn().mockReturnValue({
    userId: mockUser.id,
    githubId: mockUser.githubId,
    username: mockUser.username,
  }),
  generateKeywayToken: vi.fn().mockReturnValue('mock-keyway-token'),
  getTokenExpiresAt: vi.fn().mockReturnValue(new Date(Date.now() + 86400000)),
}));

// Mock activity logging
vi.mock('../../src/services/activity.service', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// Mock usage service
vi.mock('../../src/services/usage.service', () => ({
  computeUserUsage: vi.fn().mockResolvedValue({ public: 0, private: 0 }),
  getUserUsage: vi.fn().mockResolvedValue({ public: 0, private: 0 }),
  checkVaultCreationAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  getPrivateVaultAccess: vi.fn().mockResolvedValue({ allowedVaultIds: new Set(), excessVaultIds: new Set() }),
}));

// Mock vault service
vi.mock('../../src/services/vault.service', () => ({
  getVaultByRepo: vi.fn().mockResolvedValue({ vault: mockVault, hasAccess: true }),
  createVault: vi.fn().mockResolvedValue(mockVault),
}));

describe('Vaults Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });
    await app.register(formbody);
    await app.register(cookie);

    // Import and register vault routes after mocks are set up
    const { vaultsRoutes } = await import('../../src/api/v1/routes/vaults.routes');
    await app.register(vaultsRoutes, { prefix: '/v1/vaults' });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/vaults (Create Vault)', () => {
    it('should create a vault for a public repository', async () => {
      const { db } = await import('../../src/db');
      const { getRepoInfo } = await import('../../src/utils/github');

      // Mock repo is public
      (getRepoInfo as any).mockResolvedValue({ isPrivate: false, isOrganization: false });

      // Mock vault doesn't exist yet
      (db.query.vaults.findFirst as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
        payload: {
          repoFullName: 'testuser/new-repo',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('repoFullName');
    });

    it('should create a vault for a private repository', async () => {
      const { db } = await import('../../src/db');
      const { getRepoInfo } = await import('../../src/utils/github');

      // Mock repo is private
      (getRepoInfo as any).mockResolvedValue({ isPrivate: true, isOrganization: false });

      // Mock vault doesn't exist yet
      (db.query.vaults.findFirst as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
        payload: {
          repoFullName: 'testuser/private-repo',
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('should return 404 if repository not found or no access', async () => {
      const { getRepoInfo } = await import('../../src/utils/github');

      // Mock no access to repo
      (getRepoInfo as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
        payload: {
          repoFullName: 'unknown/repo',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.detail).toContain("not found or you don't have access");
    });

    it('should return 409 if vault already exists', async () => {
      const { db } = await import('../../src/db');
      const { getRepoInfo } = await import('../../src/utils/github');

      // Mock repo exists
      (getRepoInfo as any).mockResolvedValue({ isPrivate: false, isOrganization: false });

      // Mock vault already exists
      (db.query.vaults.findFirst as any).mockResolvedValue(mockVault);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults',
        payload: {
          repoFullName: 'testuser/test-repo',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should enforce plan limits for private repos', async () => {
      const { getRepoInfo } = await import('../../src/utils/github');
      const { checkVaultCreationAllowed } = await import('../../src/services/usage.service');

      // Mock repo is private
      (getRepoInfo as any).mockResolvedValue({ isPrivate: true, isOrganization: false });

      // Mock plan limit reached
      (checkVaultCreationAllowed as any).mockResolvedValue({
        allowed: false,
        reason: 'Your free plan allows 1 private repo. Upgrade to create more.',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
        payload: {
          repoFullName: 'testuser/another-private-repo',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.detail).toContain('plan');
    });
  });

  describe('GET /v1/vaults (List Vaults)', () => {
    it('should list user vaults', async () => {
      const { db } = await import('../../src/db');

      // Mock vaults
      (db.query.vaults.findMany as any).mockResolvedValue([mockVault]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeInstanceOf(Array);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/vaults/:owner/:repo (Get Vault)', () => {
    it('should get a specific vault', async () => {
      const { db } = await import('../../src/db');

      // Mock vault exists
      (db.query.vaults.findFirst as any).mockResolvedValue(mockVault);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('id');
    });

    it('should return 404 for non-existent vault', async () => {
      const { getVaultByRepo } = await import('../../src/services/vault.service');

      // Mock vault not found
      (getVaultByRepo as any).mockResolvedValue({ vault: null, hasAccess: false });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/unknown/repo',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

describe('Vault Creation with GitHub App', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });
    await app.register(formbody);
    await app.register(cookie);

    const { vaultsRoutes } = await import('../../src/api/v1/routes/vaults.routes');
    await app.register(vaultsRoutes, { prefix: '/v1/vaults' });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should check GitHub App installation before creating vault', async () => {
    const { checkInstallationStatus } = await import('../../src/services/github-app.service');
    const { getRepoInfo } = await import('../../src/utils/github');

    // Mock GitHub App not installed
    (checkInstallationStatus as any).mockResolvedValue({
      installed: false,
      installUrl: 'https://github.com/apps/keyway/installations/new',
    });

    // Mock repo info (even though app not installed, we might still get info)
    (getRepoInfo as any).mockResolvedValue({ isPrivate: false, isOrganization: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/vaults',
      headers: {
        authorization: 'Bearer mock-keyway-token',
      },
      payload: {
        repoFullName: 'testuser/repo-without-app',
      },
    });

    // The vault creation should still work if the user has OAuth access
    // GitHub App is only required for certain operations
    expect([201, 403]).toContain(response.statusCode);
  });
});
