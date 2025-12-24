import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { mockUser, mockVault, createMockGitHubUtils } from '../helpers/mocks';
import { ForbiddenError } from '../../src/lib';

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

// Mock secret data
const mockActiveSecret = {
  id: 'secret-active-123',
  vaultId: mockVault.id,
  key: 'API_KEY',
  environment: 'production',
  encryptedValue: 'encrypted-value',
  iv: '0'.repeat(32),
  authTag: '0'.repeat(32),
  encryptionVersion: 1,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTrashedSecret = {
  id: 'secret-trashed-123',
  vaultId: mockVault.id,
  key: 'OLD_API_KEY',
  environment: 'production',
  encryptedValue: 'encrypted-value',
  iv: '0'.repeat(32),
  authTag: '0'.repeat(32),
  encryptionVersion: 1,
  deletedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Mock database - aligned with vaults.routes.test.ts
vi.mock('../../src/db', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue(mockUser),
        findMany: vi.fn().mockResolvedValue([mockUser]),
      },
      vaults: {
        findFirst: vi.fn().mockResolvedValue(mockVault),
        findMany: vi.fn().mockResolvedValue([mockVault]),
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
      organizations: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      organizationMembers: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
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
        returning: vi.fn().mockResolvedValue([mockActiveSecret]),
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
  users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
  vaults: { id: 'id', forgeType: 'forgeType', repoFullName: 'repoFullName', ownerId: 'ownerId', isPrivate: 'isPrivate' },
  secrets: { id: 'id', vaultId: 'vaultId', deletedAt: 'deletedAt' },
  deviceCodes: { id: 'id' },
  vcsAppInstallations: { installationId: 'installationId', accountLogin: 'accountLogin' },
  vcsAppInstallationRepos: { repoFullName: 'repoFullName' },
  activityLogs: { id: 'id' },
  usageMetrics: { userId: 'userId' },
  vaultEnvironments: { vaultId: 'vaultId' },
  organizations: { id: 'id', forgeType: 'forgeType', forgeOrgId: 'forgeOrgId', login: 'login' },
  organizationMembers: { id: 'id', orgId: 'orgId', userId: 'userId' },
}));

// Mock GitHub utils - includes getUserRoleWithApp
const mockGitHubUtils = createMockGitHubUtils();
vi.mock('../../src/utils/github', () => mockGitHubUtils);

// Mock GitHub App service
vi.mock('../../src/services/github-app.service', () => ({
  handleInstallationCreated: vi.fn().mockResolvedValue({ installationId: 12345 }),
  findInstallationForRepo: vi.fn().mockResolvedValue({ installationId: 12345 }),
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
    SECRET_CREATED: 'api_secret_created',
    SECRET_DELETED: 'api_secret_deleted',
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
  getVaultByRepo: vi.fn().mockImplementation(() => Promise.resolve({ vault: mockVault, hasAccess: true })),
  getVaultByRepoInternal: vi.fn().mockImplementation(() => Promise.resolve(mockVault)),
  getVaultsForUser: vi.fn().mockResolvedValue([mockVault]),
  createVault: vi.fn().mockResolvedValue(mockVault),
  touchVault: vi.fn().mockResolvedValue(undefined),
  canWriteToVault: vi.fn().mockImplementation(() => Promise.resolve({ allowed: true })),
}));

// Mock permissions utils
vi.mock('../../src/utils/permissions', () => ({
  getVaultPermissions: vi.fn().mockResolvedValue([]),
  getDefaultPermission: vi.fn().mockReturnValue('read'),
  resolveEffectivePermission: vi.fn().mockResolvedValue(true),
  getEffectivePermissions: vi.fn().mockResolvedValue({ development: { read: true, write: true } }),
  requireEnvironmentPermission: vi.fn().mockResolvedValue(undefined), // Resolves without throwing = permission granted
}));

// Mock config/plans
vi.mock('../../src/config/plans', () => ({
  canCreateEnvironment: vi.fn().mockReturnValue({ allowed: true }),
  canCreateSecret: vi.fn().mockReturnValue({ allowed: true }),
}));

// Mock security service
vi.mock('../../src/services/security.service', () => ({
  getSecurityAlerts: vi.fn().mockResolvedValue([]),
}));

// Mock secret service - the critical trash functions
vi.mock('../../src/services/secret.service', () => ({
  getSecretsForVault: vi.fn().mockResolvedValue([]),
  getSecretsCount: vi.fn().mockResolvedValue(0),
  upsertSecret: vi.fn().mockResolvedValue({ id: 'secret-id' }),
  updateSecret: vi.fn().mockResolvedValue({ id: 'secret-id' }),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  secretExists: vi.fn().mockResolvedValue(false),

  // Trash functions
  trashSecret: vi.fn().mockImplementation((secretId, vaultId) => {
    if (secretId === mockActiveSecret.id) {
      const deletedAt = new Date();
      const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      return Promise.resolve({
        key: mockActiveSecret.key,
        environment: mockActiveSecret.environment,
        deletedAt,
        expiresAt,
      });
    }
    return Promise.resolve(null);
  }),

  getTrashedSecrets: vi.fn().mockImplementation(() => {
    const trashedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    return Promise.resolve([{
      id: mockTrashedSecret.id,
      key: mockTrashedSecret.key,
      environment: mockTrashedSecret.environment,
      deletedAt: trashedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      daysRemaining: 25,
    }]);
  }),

  getTrashedSecretsCount: vi.fn().mockResolvedValue(1),

  restoreSecret: vi.fn().mockImplementation((secretId) => {
    if (secretId === mockTrashedSecret.id) {
      return Promise.resolve({
        id: mockTrashedSecret.id,
        key: mockTrashedSecret.key,
        environment: mockTrashedSecret.environment,
      });
    }
    if (secretId === 'conflict-secret-id') {
      return Promise.reject(new Error(`Secret "EXISTING_KEY" already exists in production`));
    }
    return Promise.resolve(null);
  }),

  permanentlyDeleteSecret: vi.fn().mockImplementation((secretId) => {
    if (secretId === mockTrashedSecret.id) {
      return Promise.resolve({
        key: mockTrashedSecret.key,
        environment: mockTrashedSecret.environment,
      });
    }
    return Promise.resolve(null);
  }),

  emptyTrash: vi.fn().mockResolvedValue({ deleted: 2, keys: ['KEY1', 'KEY2'] }),

  trashSecretsByIds: vi.fn().mockResolvedValue(undefined),

  purgeExpiredTrash: vi.fn().mockResolvedValue({ purged: 1 }),

  generatePreview: vi.fn().mockReturnValue('test••••alue'),
}));

// Mock services barrel export
vi.mock('../../src/services', () => ({
  getVaultByRepo: vi.fn().mockImplementation(() => Promise.resolve({ vault: mockVault, hasAccess: true })),
  getVaultByRepoInternal: vi.fn().mockImplementation(() => Promise.resolve(mockVault)),
  getVaultsForUser: vi.fn().mockResolvedValue([mockVault]),
  createVault: vi.fn().mockResolvedValue(mockVault),
  touchVault: vi.fn().mockResolvedValue(undefined),
  canWriteToVault: vi.fn().mockImplementation(() => Promise.resolve({ allowed: true })),
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

  // Trash functions
  trashSecret: vi.fn().mockImplementation((secretId, vaultId) => {
    if (secretId === mockActiveSecret.id) {
      const deletedAt = new Date();
      const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      return Promise.resolve({
        key: mockActiveSecret.key,
        environment: mockActiveSecret.environment,
        deletedAt,
        expiresAt,
      });
    }
    return Promise.resolve(null);
  }),
  getTrashedSecrets: vi.fn().mockImplementation(() => {
    const trashedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    return Promise.resolve([{
      id: mockTrashedSecret.id,
      key: mockTrashedSecret.key,
      environment: mockTrashedSecret.environment,
      deletedAt: trashedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      daysRemaining: 25,
    }]);
  }),
  getTrashedSecretsCount: vi.fn().mockResolvedValue(1),
  getTrashedSecretById: vi.fn().mockImplementation((secretId, vaultId) => {
    if (secretId === mockTrashedSecret.id) {
      return Promise.resolve(mockTrashedSecret);
    }
    if (secretId === 'conflict-secret-id') {
      return Promise.resolve({ ...mockTrashedSecret, id: 'conflict-secret-id', key: 'EXISTING_KEY' });
    }
    return Promise.resolve(null);
  }),
  restoreSecret: vi.fn().mockImplementation((secretId) => {
    if (secretId === mockTrashedSecret.id) {
      return Promise.resolve({
        id: mockTrashedSecret.id,
        key: mockTrashedSecret.key,
        environment: mockTrashedSecret.environment,
      });
    }
    if (secretId === 'conflict-secret-id') {
      return Promise.reject(new Error(`Secret "EXISTING_KEY" already exists in production`));
    }
    return Promise.resolve(null);
  }),
  permanentlyDeleteSecret: vi.fn().mockImplementation((secretId) => {
    if (secretId === mockTrashedSecret.id) {
      return Promise.resolve({
        key: mockTrashedSecret.key,
        environment: mockTrashedSecret.environment,
      });
    }
    return Promise.resolve(null);
  }),
  emptyTrash: vi.fn().mockResolvedValue({ deleted: 2, keys: ['KEY1', 'KEY2'] }),
  trashSecretsByIds: vi.fn().mockResolvedValue(undefined),

  logActivity: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
  detectPlatform: vi.fn().mockReturnValue('api'),
  checkVaultCreationAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  computeUserUsage: vi.fn().mockResolvedValue({ public: 0, private: 0 }),
  getPrivateVaultAccess: vi.fn().mockResolvedValue({ allowedVaultIds: new Set(), excessVaultIds: new Set() }),
}));

describe('Trash Routes', () => {
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

  describe('DELETE /v1/vaults/:owner/:repo/secrets/:id (Soft Delete)', () => {
    it('should soft-delete a secret and return trash info', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/secrets/${mockActiveSecret.id}`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('key', mockActiveSecret.key);
      expect(body.data).toHaveProperty('environment', mockActiveSecret.environment);
      expect(body.data).toHaveProperty('deletedAt');
      expect(body.data).toHaveProperty('expiresAt');
      // daysRemaining is calculated from dates, verify it's present or close to 30
    });

    it('should return 404 for non-existent secret', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/secrets/nonexistent-id`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/secrets/${mockActiveSecret.id}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require write access', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      const { requireEnvironmentPermission } = await import('../../src/utils/permissions');
      (getUserRoleWithApp as any).mockResolvedValueOnce('read');
      // Mock requireEnvironmentPermission to throw ForbiddenError for write permission
      (requireEnvironmentPermission as any).mockRejectedValueOnce(
        new ForbiddenError('Your role (read) does not have permission to write to the "production" environment')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/secrets/${mockActiveSecret.id}`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /v1/vaults/:owner/:repo/trash (List Trashed Secrets)', () => {
    it('should return list of trashed secrets with expiration info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/trash',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data[0]).toHaveProperty('id');
      expect(body.data[0]).toHaveProperty('key');
      expect(body.data[0]).toHaveProperty('environment');
      expect(body.data[0]).toHaveProperty('deletedAt');
      expect(body.data[0]).toHaveProperty('expiresAt');
      expect(body.data[0]).toHaveProperty('daysRemaining');
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/trash',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent vault', async () => {
      const services = await import('../../src/services');
      (services.getVaultByRepoInternal as any).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/unknown/repo/trash',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/vaults/:owner/:repo/trash/:id/restore (Restore Secret)', () => {
    it('should restore a trashed secret', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/vaults/testuser/test-repo/trash/${mockTrashedSecret.id}/restore`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('id', mockTrashedSecret.id);
      expect(body.data).toHaveProperty('key', mockTrashedSecret.key);
      expect(body.data).toHaveProperty('environment', mockTrashedSecret.environment);
    });

    it('should return 404 for non-existent trashed secret', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults/testuser/test-repo/trash/nonexistent-id/restore',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 409 if key+environment conflict exists', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults/testuser/test-repo/trash/conflict-secret-id/restore',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should require write access', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      const { requireEnvironmentPermission } = await import('../../src/utils/permissions');
      (getUserRoleWithApp as any).mockResolvedValueOnce('read');
      // Mock requireEnvironmentPermission to throw ForbiddenError for write permission
      (requireEnvironmentPermission as any).mockRejectedValueOnce(
        new ForbiddenError('Your role (read) does not have permission to write to the "production" environment')
      );

      const response = await app.inject({
        method: 'POST',
        url: `/v1/vaults/testuser/test-repo/trash/${mockTrashedSecret.id}/restore`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /v1/vaults/:owner/:repo/trash/:id (Permanent Delete)', () => {
    it('should permanently delete a trashed secret', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/trash/${mockTrashedSecret.id}`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      // Permanent delete returns 204 No Content
      expect(response.statusCode).toBe(204);
    });

    it('should return 404 for non-existent trashed secret', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/trash/nonexistent-id',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require write access', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      const { requireEnvironmentPermission } = await import('../../src/utils/permissions');
      (getUserRoleWithApp as any).mockResolvedValueOnce('read');
      // Mock requireEnvironmentPermission to throw ForbiddenError for write permission
      (requireEnvironmentPermission as any).mockRejectedValueOnce(
        new ForbiddenError('Your role (read) does not have permission to write to the "production" environment')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/trash/${mockTrashedSecret.id}`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /v1/vaults/:owner/:repo/trash (Empty Trash)', () => {
    it('should empty all trash for a vault', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/trash',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('deleted', 2);
    });

    it('should require write access', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      (getUserRoleWithApp as any).mockResolvedValueOnce('read');

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/trash',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should handle empty trash gracefully', async () => {
      const services = await import('../../src/services');
      (services.emptyTrash as any).mockResolvedValueOnce({ deleted: 0, keys: [] });

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/trash',
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.deleted).toBe(0);
    });
  });

  describe('Activity Logging', () => {
    it('should log activity when secret is trashed', async () => {
      const services = await import('../../src/services');

      await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/secrets/${mockActiveSecret.id}`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(services.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'secret_trashed',
          vaultId: mockVault.id,
        })
      );
    });

    it('should log activity when secret is restored', async () => {
      const services = await import('../../src/services');

      await app.inject({
        method: 'POST',
        url: `/v1/vaults/testuser/test-repo/trash/${mockTrashedSecret.id}/restore`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(services.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'secret_restored',
          vaultId: mockVault.id,
        })
      );
    });

    it('should log activity when secret is permanently deleted', async () => {
      const services = await import('../../src/services');

      await app.inject({
        method: 'DELETE',
        url: `/v1/vaults/testuser/test-repo/trash/${mockTrashedSecret.id}`,
        headers: {
          authorization: 'Bearer mock-keyway-token',
        },
      });

      expect(services.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'secret_permanently_deleted',
          vaultId: mockVault.id,
        })
      );
    });
  });
});
