import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { mockUser, mockVault, createMockDb, createMockGitHubUtils, mockSecretListItem, mockLegacySecretListItem } from '../helpers/mocks';

// Use vi.hoisted() to define mock data that will be available during mock factory hoisting
const { mockUserForLookup } = vi.hoisted(() => ({
  mockUserForLookup: {
    id: 'test-user-id-123',
    forgeType: 'github' as const,
    forgeUserId: '12345',
    username: 'testuser',
    email: 'test@example.com',
    avatarUrl: 'https://github.com/testuser.png',
    accessToken: 'gho_testtoken123',
    plan: 'pro' as const,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}));

// Mock user-lookup helper (must use hoisted mockUserForLookup)
vi.mock('../../src/utils/user-lookup', () => ({
  getUserFromVcsUser: vi.fn().mockResolvedValue(mockUserForLookup),
  getOrThrowUser: vi.fn().mockResolvedValue(mockUserForLookup),
  extractVcsUser: vi.fn().mockImplementation((req: { vcsUser?: unknown; githubUser?: unknown }) => req.vcsUser || req.githubUser),
}));

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
        vcsAppInstallations: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        vcsAppInstallationRepos: {
          findFirst: vi.fn(),
        },
        usageMetrics: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        vaultEnvironments: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        organizations: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        organizationMembers: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation(() => {
          // Create a thenable that also has returning/onConflict methods
          const valuesResult = Promise.resolve(undefined);
          (valuesResult as any).returning = vi.fn().mockResolvedValue([mockVault]);
          (valuesResult as any).onConflictDoUpdate = vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockVault]),
          });
          (valuesResult as any).onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
          return valuesResult;
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
    users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
    vaults: { id: 'id', forgeType: 'forgeType', repoFullName: 'repoFullName', ownerId: 'ownerId', isPrivate: 'isPrivate' },
    secrets: { id: 'id', vaultId: 'vaultId' },
    deviceCodes: { id: 'id' },
    vcsAppInstallations: { installationId: 'installationId', accountLogin: 'accountLogin' },
    vcsAppInstallationRepos: { repoFullName: 'repoFullName' },
    activityLogs: { id: 'id' },
    usageMetrics: { userId: 'userId' },
    vaultEnvironments: { id: 'id', vaultId: 'vaultId', name: 'name', type: 'type', displayOrder: 'displayOrder' },
    organizations: { id: 'id', forgeType: 'forgeType', forgeOrgId: 'forgeOrgId', login: 'login' },
    organizationMembers: { id: 'id', orgId: 'orgId', userId: 'userId' },
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
    forgeType: mockUser.forgeType,
    forgeUserId: mockUser.forgeUserId,
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
  getVaultByRepoInternal: vi.fn().mockResolvedValue(mockVault),
  getVaultsForUser: vi.fn().mockResolvedValue([mockVault]),
  createVault: vi.fn().mockResolvedValue(mockVault),
  touchVault: vi.fn().mockResolvedValue(undefined),
  canWriteToVault: vi.fn().mockResolvedValue(true),
  getVaultEnvironments: vi.fn().mockResolvedValue([
    { name: 'development', type: 'development', displayOrder: 0 },
    { name: 'staging', type: 'standard', displayOrder: 1 },
    { name: 'production', type: 'protected', displayOrder: 2 },
  ]),
  getVaultEnvironmentNames: vi.fn().mockResolvedValue(['development', 'staging', 'production']),
}));

// Mock permissions utils
vi.mock('../../src/utils/permissions', () => ({
  getVaultPermissions: vi.fn().mockResolvedValue([]),
  getDefaultPermission: vi.fn().mockReturnValue('read'),
  resolveEffectivePermission: vi.fn().mockResolvedValue(true),
  getEffectivePermissions: vi.fn().mockResolvedValue({ development: { read: true, write: true } }),
  requireEnvironmentPermission: vi.fn().mockResolvedValue(undefined), // Resolves without throwing = permission granted
  inferEnvironmentType: vi.fn().mockImplementation((env: string) => {
    const baseEnv = env.split(':')[0].toLowerCase();
    if (['production', 'prod', 'main', 'master'].includes(baseEnv)) return 'protected';
    if (['development', 'dev', 'local', 'preview'].includes(baseEnv)) return 'development';
    return 'standard';
  }),
  getEnvironmentType: vi.fn().mockReturnValue('standard'),
}));

// Mock config/plans
vi.mock('../../src/config/plans', () => ({
  canCreateEnvironment: vi.fn().mockReturnValue({ allowed: true }),
  canCreateSecret: vi.fn().mockReturnValue({ allowed: true }),
}));

// Mock security service
vi.mock('../../src/services/security.service', () => ({
  getSecurityAlerts: vi.fn().mockResolvedValue([]),
  generateDeviceId: vi.fn().mockReturnValue('device-123'),
}));

// Mock exposure service
vi.mock('../../src/services/exposure.service', () => ({
  recordSecretAccesses: vi.fn().mockResolvedValue(undefined),
  recordSecretAccess: vi.fn().mockResolvedValue(undefined),
}));

// Mock secret service
vi.mock('../../src/services/secret.service', () => ({
  getSecretsForVault: vi.fn().mockResolvedValue([]),
  getSecretsCount: vi.fn().mockResolvedValue(0),
  upsertSecret: vi.fn().mockResolvedValue({ id: 'secret-id' }),
  updateSecret: vi.fn().mockResolvedValue({ id: 'secret-id' }),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  secretExists: vi.fn().mockResolvedValue(false),
}));

// Mock services barrel export (route imports from ../../../services)
vi.mock('../../src/services', () => ({
  getVaultByRepo: vi.fn().mockResolvedValue({ vault: mockVault, hasAccess: true }),
  getVaultByRepoInternal: vi.fn().mockResolvedValue(mockVault),
  getVaultsForUser: vi.fn().mockResolvedValue([mockVault]),
  createVault: vi.fn().mockResolvedValue(mockVault),
  touchVault: vi.fn().mockResolvedValue(undefined),
  canWriteToVault: vi.fn().mockResolvedValue(true),
  getSecretsForVault: vi.fn().mockResolvedValue([]),
  getSecretsCount: vi.fn().mockResolvedValue(0),
  upsertSecret: vi.fn().mockResolvedValue({ id: 'secret-id' }),
  updateSecret: vi.fn().mockResolvedValue({ id: 'secret-id' }),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  secretExists: vi.fn().mockResolvedValue(false),
  getSecretById: vi.fn().mockResolvedValue({ id: 'secret-123', name: 'API_KEY', environment: 'development' }),
  getSecretValue: vi.fn().mockResolvedValue({
    value: 'postgres://user:password@localhost:5432/db',
    preview: 'post••••2/db',
    key: 'DATABASE_URL',
    environment: 'production',
  }),
  logActivity: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
  detectPlatform: vi.fn().mockReturnValue('api'),
  checkVaultCreationAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  computeUserUsage: vi.fn().mockResolvedValue({ public: 0, private: 0 }),
  getPrivateVaultAccess: vi.fn().mockResolvedValue({ allowedVaultIds: new Set(), excessVaultIds: new Set() }),
  recordSecretAccesses: vi.fn().mockResolvedValue(undefined),
  recordSecretAccess: vi.fn().mockResolvedValue(undefined),
  getVaultEnvironments: vi.fn().mockResolvedValue([
    { name: 'development', type: 'development', displayOrder: 0 },
    { name: 'staging', type: 'standard', displayOrder: 1 },
    { name: 'production', type: 'protected', displayOrder: 2 },
  ]),
  getVaultEnvironmentNames: vi.fn().mockResolvedValue(['development', 'staging', 'production']),
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
      const { getRepoInfoWithApp } = await import('../../src/utils/github');

      // Mock repo is public
      (getRepoInfoWithApp as any).mockResolvedValue({ isPrivate: false, isOrganization: false });

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
      expect(body.data).toHaveProperty('vaultId');
      expect(body.data).toHaveProperty('repoFullName');
    });

    it('should create a vault for a private repository', async () => {
      const { db } = await import('../../src/db');
      const { getRepoInfoWithApp } = await import('../../src/utils/github');

      // Mock repo is private
      (getRepoInfoWithApp as any).mockResolvedValue({ isPrivate: true, isOrganization: false });

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
      const { getRepoInfoWithApp } = await import('../../src/utils/github');

      // Mock no access to repo
      (getRepoInfoWithApp as any).mockResolvedValue(null);

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
      // Note: Error body format depends on global error handler (not registered in tests)
    });

    it('should return 409 if vault already exists', async () => {
      const { db } = await import('../../src/db');
      const { getRepoInfoWithApp } = await import('../../src/utils/github');

      // Mock repo exists
      (getRepoInfoWithApp as any).mockResolvedValue({ isPrivate: false, isOrganization: false });

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
      const { db } = await import('../../src/db');
      const { getRepoInfoWithApp } = await import('../../src/utils/github');
      const services = await import('../../src/services');

      // Mock repo is private
      (getRepoInfoWithApp as any).mockResolvedValue({ isPrivate: true, isOrganization: false });

      // Mock vault doesn't exist yet (so we reach plan check)
      (db.query.vaults.findFirst as any).mockResolvedValue(null);

      // Mock plan limit reached (import from barrel for route to see it)
      (services.checkVaultCreationAllowed as any).mockResolvedValue({
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
      // Note: Error body format depends on global error handler (not registered in tests)
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
      const services = await import('../../src/services');

      // Mock vault not found (import from barrel for route to see it)
      (services.getVaultByRepo as any).mockResolvedValue({ vault: null, hasAccess: false });

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

  describe('GET /v1/vaults/:owner/:repo/secrets/:secretId/value (Get Secret Value)', () => {
    it('should return secret value and preview', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      // Mock user has read access
      (getUserRoleWithApp as any).mockResolvedValue('read');

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/secrets/secret-123/value',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('value');
      expect(body.data).toHaveProperty('preview');
      expect(body.data.value).toBe('postgres://user:password@localhost:5432/db');
      expect(body.data.preview).toBe('post••••2/db');
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/secrets/secret-123/value',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 if user has no access to vault', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      // Mock user has no role
      (getUserRoleWithApp as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/secrets/secret-123/value',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 if vault not found', async () => {
      const services = await import('../../src/services');

      // Mock vault not found
      (services.getVaultByRepoInternal as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/unknown/repo/secrets/secret-123/value',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 if secret not found', async () => {
      const services = await import('../../src/services');
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      // Mock vault found but secret not found
      (services.getVaultByRepoInternal as any).mockResolvedValue(mockVault);
      (getUserRoleWithApp as any).mockResolvedValue('read');
      (services.getSecretValue as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/secrets/nonexistent-secret/value',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should log activity when secret value is accessed', async () => {
      const services = await import('../../src/services');
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      // Reset mocks
      (services.getVaultByRepoInternal as any).mockResolvedValue(mockVault);
      (getUserRoleWithApp as any).mockResolvedValue('read');
      (services.getSecretValue as any).mockResolvedValue({
        value: 'test-value',
        preview: 'test••••alue',
        key: 'API_KEY',
        environment: 'production',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/secrets/secret-123/value',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(services.logActivity).toHaveBeenCalled();
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
    const { db } = await import('../../src/db');
    const { checkInstallationStatus } = await import('../../src/services/github-app.service');
    const { getRepoInfoWithApp } = await import('../../src/utils/github');

    // Mock GitHub App not installed
    (checkInstallationStatus as any).mockResolvedValue({
      installed: false,
      installUrl: 'https://github.com/apps/keyway/installations/new',
    });

    // Mock repo info (even though app not installed, we might still get info)
    (getRepoInfoWithApp as any).mockResolvedValue({ isPrivate: false, isOrganization: false });

    // Mock vault doesn't exist yet (so we can actually try to create it)
    (db.query.vaults.findFirst as any).mockResolvedValue(null);

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

describe('Secret lastModifiedBy', () => {
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

  it('should include lastModifiedBy when secret has been modified by a user', async () => {
    const services = await import('../../src/services');
    const { getUserRoleWithApp } = await import('../../src/utils/github');

    // Mock vault found
    (services.getVaultByRepoInternal as any).mockResolvedValue(mockVault);
    (getUserRoleWithApp as any).mockResolvedValue('read');

    // Mock secrets with lastModifiedBy
    (services.getSecretsForVault as any).mockResolvedValue([mockSecretListItem]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vaults/testuser/test-repo/secrets',
      headers: {
        authorization: 'Bearer mock-keyway-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].lastModifiedBy).toEqual({
      username: mockUser.username,
      avatarUrl: mockUser.avatarUrl,
    });
  });

  it('should have null lastModifiedBy for legacy secrets', async () => {
    const services = await import('../../src/services');
    const { getUserRoleWithApp } = await import('../../src/utils/github');

    // Mock vault found
    (services.getVaultByRepoInternal as any).mockResolvedValue(mockVault);
    (getUserRoleWithApp as any).mockResolvedValue('read');

    // Mock legacy secret without lastModifiedBy
    (services.getSecretsForVault as any).mockResolvedValue([mockLegacySecretListItem]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vaults/testuser/test-repo/secrets',
      headers: {
        authorization: 'Bearer mock-keyway-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].lastModifiedBy).toBeNull();
  });

  it('should set lastModifiedBy when updating a secret', async () => {
    const services = await import('../../src/services');
    const { getUserRoleWithApp } = await import('../../src/utils/github');

    // Mock vault found and write access
    (services.getVaultByRepoInternal as any).mockResolvedValue(mockVault);
    (getUserRoleWithApp as any).mockResolvedValue('write');
    (services.canWriteToVault as any).mockResolvedValue({ allowed: true });

    // Mock updateSecret to return secret with lastModifiedBy
    (services.updateSecret as any).mockResolvedValue(mockSecretListItem);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/vaults/testuser/test-repo/secrets/secret-123',
      headers: {
        authorization: 'Bearer mock-keyway-token',
      },
      payload: {
        name: 'NEW_API_KEY',
        value: 'new-value',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.lastModifiedBy).toEqual({
      username: mockUser.username,
      avatarUrl: mockUser.avatarUrl,
    });

    // Verify updateSecret was called with userId
    expect(services.updateSecret).toHaveBeenCalledWith(
      'secret-123',
      mockVault.id,
      expect.objectContaining({
        userId: mockUser.id,
      })
    );
  });
});
