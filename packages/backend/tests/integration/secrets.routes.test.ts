import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockVault, mockSecret, mockApiKey, mockApiKeyReadOnly, mockApiKeyAdminOnly } from '../helpers/mocks';

// Complete mock user with all required fields for auth middleware
const mockUserWithToken = {
  ...mockUser,
  encryptedAccessToken: 'encrypted-token',
  accessTokenIv: 'mock-iv',
  accessTokenAuthTag: 'mock-auth-tag',
  tokenEncryptionVersion: 1,
};

// Mock the database module BEFORE other mocks
vi.mock('../../src/db', () => {
  const mockQuery = {
    users: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    vaults: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    secrets: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    apiKeys: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    vcsAppInstallations: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
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
  };

  return {
    db: {
      query: mockQuery,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
    users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
    vaults: { id: 'id', repoFullName: 'repoFullName' },
    secrets: { id: 'id', vaultId: 'vaultId', environment: 'environment', key: 'key', deletedAt: 'deletedAt' },
    apiKeys: { id: 'id', keyHash: 'keyHash', revokedAt: 'revokedAt' },
    vcsAppInstallations: { installationId: 'installationId' },
    vcsAppInstallationRepos: { repoFullName: 'repoFullName' },
  };
});

// Mock JWT
vi.mock('../../src/utils/jwt', () => ({
  verifyKeywayToken: vi.fn().mockReturnValue({
    userId: 'test-user-id-123',
    forgeType: 'github',
    forgeUserId: '12345',
    username: 'testuser',
  }),
  generateKeywayToken: vi.fn().mockReturnValue('mock-keyway-token'),
  getTokenExpiresAt: vi.fn().mockReturnValue(new Date(Date.now() + 86400000)),
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

// Mock GitHub utils
vi.mock('../../src/utils/github', () => ({
  getUserFromToken: vi.fn().mockResolvedValue({
    forgeType: 'github',
    forgeUserId: '12345',
    username: 'testuser',
    email: 'test@example.com',
    avatarUrl: 'https://github.com/testuser.png',
  }),
  getUserRoleWithApp: vi.fn().mockResolvedValue('admin'),
  hasRepoAccess: vi.fn().mockResolvedValue(true),
  hasAdminAccess: vi.fn().mockResolvedValue(true),
  getRepoPermission: vi.fn().mockResolvedValue('admin'),
}));

// Mock permissions
vi.mock('../../src/utils/permissions', () => ({
  getVaultPermissions: vi.fn().mockResolvedValue([]),
  getDefaultPermission: vi.fn().mockReturnValue('read'),
  resolveEffectivePermission: vi.fn().mockResolvedValue(true),
  hasEnvironmentPermission: vi.fn().mockResolvedValue(true),
  getEffectivePermissions: vi.fn().mockResolvedValue({ development: { read: true, write: true } }),
}));

// Mock encryption service
vi.mock('../../src/utils/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue({
      encryptedContent: 'encrypted-value',
      iv: 'mock-iv',
      authTag: 'mock-auth-tag',
      version: 1,
    }),
    decrypt: vi.fn().mockResolvedValue('decrypted-secret-value'),
  }),
  sanitizeForLogging: vi.fn((obj) => obj),
}));

// Mock analytics
vi.mock('../../src/utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    SECRETS_PUSHED: 'secrets_pushed',
    SECRETS_PULLED: 'secrets_pulled',
    SECRET_VIEWED: 'secret_viewed',
  },
}));

// Mock activity service
vi.mock('../../src/services/activity.service', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// Mock services barrel
const mockTrashSecretsByIds = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn().mockReturnValue({ ip: '127.0.0.1', userAgent: 'test' }),
  detectPlatform: vi.fn().mockReturnValue('cli'),
  trashSecretsByIds: mockTrashSecretsByIds,
  recordSecretAccesses: vi.fn().mockResolvedValue(undefined),
  recordSecretAccess: vi.fn().mockResolvedValue(undefined),
  getVaultEnvironmentNames: vi.fn().mockResolvedValue(['development', 'staging', 'production']),
}));

// Mock security service
vi.mock('../../src/services/security.service', () => ({
  processPullEvent: vi.fn().mockResolvedValue(undefined),
  generateDeviceId: vi.fn().mockReturnValue('device-123'),
}));

// Mock exposure service
vi.mock('../../src/services/exposure.service', () => ({
  recordSecretAccesses: vi.fn().mockResolvedValue(undefined),
  recordSecretAccess: vi.fn().mockResolvedValue(undefined),
}));

// Mock usage service
const mockCanWriteToVault = vi.fn().mockResolvedValue({ allowed: true });
vi.mock('../../src/services/usage.service', () => ({
  canWriteToVault: mockCanWriteToVault,
}));

// Mock apiKeys utility
const mockIsKeywayApiKey = vi.fn().mockReturnValue(false);
const mockValidateApiKeyFormat = vi.fn().mockReturnValue(false);
const mockHashApiKey = vi.fn().mockReturnValue('test-hash');
const mockHasRequiredScopes = vi.fn().mockImplementation((scopes: string[], required: string[]) => {
  return required.every(req => scopes.includes(req));
});

vi.mock('../../src/utils/apiKeys', () => ({
  isKeywayApiKey: mockIsKeywayApiKey,
  validateApiKeyFormat: mockValidateApiKeyFormat,
  hashApiKey: mockHashApiKey,
  hasRequiredScopes: mockHasRequiredScopes,
}));

// Mock config
vi.mock('../../src/config', () => ({
  config: {
    server: { isProduction: false },
  },
}));

// Note: We don't mock ../../src/types as it contains simple constants and Zod schemas
// that work fine without mocking

describe('Secrets Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset default mocks
    mockCanWriteToVault.mockResolvedValue({ allowed: true });
    mockTrashSecretsByIds.mockResolvedValue(undefined);

    app = Fastify({ logger: false });

    // Set up error handler for RFC 7807 errors (same as in src/index.ts)
    const { ApiError, ValidationError } = await import('../../src/lib/errors');
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof ApiError) {
        return reply.status(error.status).send(error.toProblemDetails(request.id));
      }
      // For non-ApiError, return generic error
      return reply.status((error as any).statusCode || 500).send({
        type: 'https://api.keyway.sh/errors/internal-error',
        title: 'Internal Server Error',
        status: (error as any).statusCode || 500,
        detail: error.message,
      });
    });

    // Import and register routes
    const { secretsRoutes } = await import('../../src/api/v1/routes/secrets.routes');
    await app.register(secretsRoutes, { prefix: '/v1/secrets' });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // Helper to set up authenticated request with valid vault
  async function setupAuthenticatedVault(vaultOverrides: Record<string, any> = {}, secretsOverrides: any[] = []) {
    const { db } = await import('../../src/db');
    const { getVaultEnvironmentNames } = await import('../../src/services');

    // Mock user lookup in auth middleware
    (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);

    // Default environments
    const environments = vaultOverrides.environments || ['development', 'staging', 'production'];

    // Mock vault
    (db.query.vaults.findFirst as any).mockResolvedValue({
      ...mockVault,
      environments,
      ...vaultOverrides,
    });

    // Mock getVaultEnvironmentNames to return the same environments
    (getVaultEnvironmentNames as any).mockResolvedValue(environments);

    // Mock secrets
    (db.query.secrets.findMany as any).mockResolvedValue(secretsOverrides);
  }

  // ==========================================================================
  // POST /push
  // ==========================================================================

  describe('POST /v1/secrets/push', () => {
    it('should push secrets successfully', async () => {
      await setupAuthenticatedVault();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development',
          secrets: {
            API_KEY: 'secret-value-1',
            DATABASE_URL: 'postgres://localhost:5432/db',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.success).toBe(true);
      expect(body.data.stats.created).toBe(2);
    });

    it('should update existing secrets', async () => {
      await setupAuthenticatedVault({}, [
        { ...mockSecret, key: 'API_KEY', id: 'existing-secret-id' },
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development',
          secrets: {
            API_KEY: 'new-secret-value',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.stats.updated).toBe(1);
    });

    it('should soft-delete removed secrets', async () => {
      await setupAuthenticatedVault({}, [
        { ...mockSecret, key: 'API_KEY', id: 'keep-this' },
        { ...mockSecret, key: 'OLD_KEY', id: 'delete-this' },
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development',
          secrets: {
            API_KEY: 'value',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockTrashSecretsByIds).toHaveBeenCalledWith(['delete-this']);
    });

    it('should return 403 for non-existent vault (access denied)', async () => {
      const { db } = await import('../../src/db');
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      // User exists in auth middleware
      (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);

      // But vault doesn't exist
      (db.query.vaults.findFirst as any).mockResolvedValue(null);

      // No role when vault doesn't exist - middleware returns 403
      (getUserRoleWithApp as any).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'unknown/repo',
          environment: 'development',
          secrets: { KEY: 'value' },
        },
      });

      // Middleware returns 403 when vault not found
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 for invalid environment', async () => {
      // Vault only has 'production' environment
      await setupAuthenticatedVault({
        environments: ['production'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development', // Not in allowed list
          secrets: { KEY: 'value' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 403 for plan limit exceeded', async () => {
      await setupAuthenticatedVault();

      // Override usage check to fail
      mockCanWriteToVault.mockResolvedValueOnce({
        allowed: false,
        reason: 'Vault is read-only',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development',
          secrets: { KEY: 'value' },
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ==========================================================================
  // GET /pull
  // ==========================================================================

  describe('GET /v1/secrets/pull', () => {
    it('should pull secrets in .env format', async () => {
      await setupAuthenticatedVault({}, [
        { ...mockSecret, key: 'API_KEY' },
        { ...mockSecret, key: 'DB_URL', id: 'secret-2' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/pull?repo=testuser/test-repo&environment=development',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.content).toContain('API_KEY=');
      expect(body.data.content).toContain('DB_URL=');
    });

    it('should return 403 for non-existent vault (access denied)', async () => {
      const { db } = await import('../../src/db');
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);
      (db.query.vaults.findFirst as any).mockResolvedValue(null);
      (getUserRoleWithApp as any).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/pull?repo=unknown/repo&environment=development',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for empty environment', async () => {
      await setupAuthenticatedVault({}, []); // No secrets

      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/pull?repo=testuser/test-repo&environment=empty-env',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // GET /view
  // ==========================================================================

  describe('GET /v1/secrets/view', () => {
    it('should return single secret value', async () => {
      await setupAuthenticatedVault({}, [
        { ...mockSecret, key: 'API_KEY' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/view?repo=testuser/test-repo&environment=development&key=API_KEY',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.key).toBe('API_KEY');
      expect(body.data.value).toBe('decrypted-secret-value');
    });

    it('should return 404 for non-existent secret', async () => {
      await setupAuthenticatedVault({}, [
        { ...mockSecret, key: 'OTHER_KEY' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/view?repo=testuser/test-repo&environment=development&key=NONEXISTENT',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for non-existent vault (access denied)', async () => {
      const { db } = await import('../../src/db');
      const { getUserRoleWithApp } = await import('../../src/utils/github');

      (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);
      (db.query.vaults.findFirst as any).mockResolvedValue(null);
      (getUserRoleWithApp as any).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/view?repo=unknown/repo&environment=development&key=API_KEY',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ==========================================================================
  // Security Tests
  // ==========================================================================

  describe('Security', () => {
    it('should require authentication for push', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development',
          secrets: { KEY: 'value' },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require authentication for pull', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/pull?repo=testuser/test-repo&environment=development',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require authentication for view', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/secrets/view?repo=testuser/test-repo&environment=development&key=API_KEY',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should enforce write permission for push', async () => {
      const { resolveEffectivePermission } = await import('../../src/utils/permissions');
      const { db } = await import('../../src/db');

      (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);
      (db.query.vaults.findFirst as any).mockResolvedValue({
        ...mockVault,
        environments: ['development'],
      });

      // Permission check fails for write
      (resolveEffectivePermission as any).mockResolvedValueOnce(false);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/secrets/push',
        headers: {
          authorization: 'Bearer valid-token',
        },
        payload: {
          repoFullName: 'testuser/test-repo',
          environment: 'development',
          secrets: { KEY: 'value' },
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ==========================================================================
  // API Key Scope Validation
  // ==========================================================================

  describe('API Key Scope Validation', () => {
    // Helper to setup API key authentication
    async function setupApiKeyAuth(apiKeyData: typeof mockApiKey) {
      const { db } = await import('../../src/db');

      // Enable API key detection
      mockIsKeywayApiKey.mockReturnValue(true);
      mockValidateApiKeyFormat.mockReturnValue(true);

      // Mock API key lookup with user relation
      (db.query.apiKeys.findFirst as any).mockResolvedValue({
        ...apiKeyData,
        user: mockUserWithToken,
      });

      // Mock vault and user
      (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);
      (db.query.vaults.findFirst as any).mockResolvedValue({
        ...mockVault,
        environments: ['development', 'staging', 'production'],
      });
    }

    afterEach(() => {
      // Reset API key mocks to default (non-API key auth)
      mockIsKeywayApiKey.mockReturnValue(false);
      mockValidateApiKeyFormat.mockReturnValue(false);
    });

    describe('Pull (read:secrets scope)', () => {
      it('should allow pull with read:secrets scope', async () => {
        const { db } = await import('../../src/db');
        await setupApiKeyAuth(mockApiKeyReadOnly);

        // Mock secrets for pull
        (db.query.secrets.findMany as any).mockResolvedValue([
          { ...mockSecret, key: 'API_KEY' },
        ]);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/secrets/pull?repo=testuser/test-repo&environment=development',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.content).toContain('API_KEY=');
      });

      it('should deny pull without read:secrets scope', async () => {
        await setupApiKeyAuth(mockApiKeyAdminOnly); // Only has admin:api-keys

        const response = await app.inject({
          method: 'GET',
          url: '/v1/secrets/pull?repo=testuser/test-repo&environment=development',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.detail).toContain('read:secrets');
      });
    });

    describe('View (read:secrets scope)', () => {
      it('should allow view with read:secrets scope', async () => {
        const { db } = await import('../../src/db');
        await setupApiKeyAuth(mockApiKeyReadOnly);

        // Mock secrets for view
        (db.query.secrets.findMany as any).mockResolvedValue([
          { ...mockSecret, key: 'API_KEY' },
        ]);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/secrets/view?repo=testuser/test-repo&environment=development&key=API_KEY',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.key).toBe('API_KEY');
      });

      it('should deny view without read:secrets scope', async () => {
        await setupApiKeyAuth(mockApiKeyAdminOnly);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/secrets/view?repo=testuser/test-repo&environment=development&key=API_KEY',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.detail).toContain('read:secrets');
      });
    });

    describe('Push (write:secrets scope)', () => {
      it('should allow push with write:secrets scope', async () => {
        await setupApiKeyAuth(mockApiKey); // Has read + write scopes

        const response = await app.inject({
          method: 'POST',
          url: '/v1/secrets/push',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
          payload: {
            repoFullName: 'testuser/test-repo',
            environment: 'development',
            secrets: { NEW_KEY: 'new-value' },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.success).toBe(true);
      });

      it('should deny push with only read:secrets scope', async () => {
        await setupApiKeyAuth(mockApiKeyReadOnly); // Only read:secrets

        const response = await app.inject({
          method: 'POST',
          url: '/v1/secrets/push',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
          payload: {
            repoFullName: 'testuser/test-repo',
            environment: 'development',
            secrets: { NEW_KEY: 'new-value' },
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.detail).toContain('write:secrets');
      });

      it('should deny push without any secrets scope', async () => {
        await setupApiKeyAuth(mockApiKeyAdminOnly); // Only admin:api-keys

        const response = await app.inject({
          method: 'POST',
          url: '/v1/secrets/push',
          headers: {
            authorization: 'Bearer kw_live_testkey123',
          },
          payload: {
            repoFullName: 'testuser/test-repo',
            environment: 'development',
            secrets: { NEW_KEY: 'new-value' },
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.detail).toContain('write:secrets');
      });
    });


    describe('JWT auth bypasses scope checks', () => {
      it('should allow push without API key (JWT auth has full access)', async () => {
        // Reset to non-API key auth
        mockIsKeywayApiKey.mockReturnValue(false);

        const { db } = await import('../../src/db');
        (db.query.users.findFirst as any).mockResolvedValue(mockUserWithToken);
        (db.query.vaults.findFirst as any).mockResolvedValue({
          ...mockVault,
          environments: ['development'],
        });
        (db.query.secrets.findMany as any).mockResolvedValue([]);

        const response = await app.inject({
          method: 'POST',
          url: '/v1/secrets/push',
          headers: {
            authorization: 'Bearer valid-jwt-token',
          },
          payload: {
            repoFullName: 'testuser/test-repo',
            environment: 'development',
            secrets: { KEY: 'value' },
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });
  });
});
