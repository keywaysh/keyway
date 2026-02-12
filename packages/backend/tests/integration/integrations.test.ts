import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/testApp';

// Use vi.hoisted to define mock data that will be available in vi.mock callbacks
const { mockUser, mockVault, mockConnection, createMockDbWithConnections, createMockGitHubUtilsForTest } = vi.hoisted(() => {
  const mockUser = {
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
  };

  const mockVault = {
    id: 'test-vault-id-123',
    repoOwner: 'testuser',
    repoName: 'test-repo',
    repoFullName: 'testuser/test-repo',
    isPrivate: false,
    environments: ['local', 'dev', 'staging', 'production'],
    ownerId: mockUser.id,
    createdById: mockUser.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConnection = {
    id: 'test-connection-id-123',
    userId: mockUser.id,
    provider: 'vercel',
    providerUserId: 'vercel-user-123',
    providerTeamId: 'team-123',
    encryptedAccessToken: 'encrypted-token',
    accessTokenIv: '0'.repeat(32),
    accessTokenAuthTag: '0'.repeat(32),
    encryptedRefreshToken: null,
    refreshTokenIv: null,
    refreshTokenAuthTag: null,
    tokenExpiresAt: null,
    scopes: ['user:read'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSecret = {
    id: 'test-secret-id-123',
    vaultId: mockVault.id,
    name: 'API_KEY',
    encryptedValue: 'encrypted-value',
    iv: '0'.repeat(32),
    authTag: '0'.repeat(32),
    environment: 'development',
    createdById: mockUser.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Create mock chain helper
  const createChain = (returnValue: any) => ({
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returnValue]),
  });

  const createMockDbWithConnections = () => {
    const mockQuery = {
      users: {
        findFirst: vi.fn().mockResolvedValue(mockUser),
        findMany: vi.fn().mockResolvedValue([mockUser]),
      },
      vaults: {
        findFirst: vi.fn().mockResolvedValue(mockVault),
        findMany: vi.fn().mockResolvedValue([mockVault]),
      },
      secrets: {
        findFirst: vi.fn().mockResolvedValue(mockSecret),
        findMany: vi.fn().mockResolvedValue([mockSecret]),
      },
      providerConnections: {
        findFirst: vi.fn().mockResolvedValue(mockConnection),
        findMany: vi.fn().mockResolvedValue([mockConnection]),
      },
      vaultSyncs: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      deviceCodes: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    return {
      query: mockQuery,
      insert: vi.fn().mockReturnValue(createChain(mockUser)),
      update: vi.fn().mockReturnValue(createChain(mockUser)),
      delete: vi.fn().mockReturnValue(createChain(null)),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      transaction: vi.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const txMock = {
          update: vi.fn().mockReturnValue(createChain(mockUser)),
          delete: vi.fn().mockReturnValue(createChain(null)),
          insert: vi.fn().mockReturnValue(createChain(mockUser)),
        };
        return callback(txMock);
      }),
    };
  };

  const createMockGitHubUtilsForTest = () => ({
    exchangeCodeForToken: vi.fn().mockResolvedValue('gho_testtoken123'),
    getGitHubUser: vi.fn().mockResolvedValue({
      id: 12345,
      login: 'testuser',
      email: 'test@example.com',
      avatar_url: 'https://github.com/testuser.png',
    }),
    getUserFromToken: vi.fn().mockResolvedValue({
      forgeType: 'github' as const,
      forgeUserId: '12345',
      username: 'testuser',
      email: 'test@example.com',
      avatarUrl: 'https://github.com/testuser.png',
    }),
    hasRepoAccess: vi.fn().mockResolvedValue(true),
    hasAdminAccess: vi.fn().mockResolvedValue(true),
    getRepoPermission: vi.fn().mockResolvedValue('admin'),
    getRepoAccessAndPermission: vi.fn().mockResolvedValue({ hasAccess: true, permission: 'admin' }),
    getUserRole: vi.fn().mockResolvedValue('admin'),
    getRepoInfo: vi.fn().mockResolvedValue({ isPrivate: false }),
    getRepoInfoWithApp: vi.fn().mockResolvedValue({ isPrivate: false, isOrganization: false }),
    getUserRoleWithApp: vi.fn().mockResolvedValue('admin'),
    getRepoCollaboratorsWithApp: vi.fn().mockResolvedValue([]),
  });

  return { mockUser, mockVault, mockConnection, createMockDbWithConnections, createMockGitHubUtilsForTest };
});

// Mock the database module
vi.mock('../../src/db', () => {
  return {
    db: createMockDbWithConnections(),
    users: { id: 'id', forgeType: 'forgeType', forgeUserId: 'forgeUserId' },
    vaults: { id: 'id', repoFullName: 'repoFullName' },
    secrets: { id: 'id', vaultId: 'vaultId', environment: 'environment' },
    providerConnections: { id: 'id', userId: 'userId', provider: 'provider', providerTeamId: 'providerTeamId' },
    vaultSyncs: { id: 'id', vaultId: 'vaultId', connectionId: 'connectionId' },
    syncLogs: { id: 'id', syncId: 'syncId' },
  };
});

// Mock GitHub utils
vi.mock('../../src/utils/github', () => createMockGitHubUtilsForTest());

// Mock auth middleware (using done callback for Fastify preHandler)
vi.mock('../../src/middleware/auth', () => ({
  authenticateGitHub: vi.fn((request: any, _reply: any, done: any) => {
    request.vcsUser = {
      forgeType: mockUser.forgeType,
      forgeUserId: mockUser.forgeUserId,
      username: mockUser.username,
      email: mockUser.email,
      avatarUrl: mockUser.avatarUrl,
    };
    request.githubUser = request.vcsUser; // Backward compatibility
    request.accessToken = 'test-token';
    done();
  }),
  requireApiKeyScope: vi.fn(() => async () => {
    // Allow access by default in tests
  }),
}));

// Mock config
vi.mock('../../src/config', () => ({
  config: {
    server: { isDevelopment: true },
    vercel: {
      clientId: 'test-vercel-client-id',
      clientSecret: 'test-vercel-client-secret',
    },
  },
}));

// Mock state utils
vi.mock('../../src/utils/state', () => ({
  signState: vi.fn().mockReturnValue('signed-state-token'),
  verifyState: vi.fn().mockReturnValue({
    type: 'provider_oauth',
    provider: 'vercel',
    userId: mockUser.id,
    redirectUri: null,
    // Integration OAuth doesn't use PKCE
  }),
}));

// Mock encryption service
vi.mock('../../src/utils/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue({
      encryptedContent: 'encrypted',
      iv: '0'.repeat(32),
      authTag: '0'.repeat(32),
    }),
    decrypt: vi.fn().mockResolvedValue('decrypted-value'),
  }),
}));

// Mock provider registry
vi.mock('../../src/services/providers', () => ({
  getProvider: vi.fn().mockReturnValue({
    name: 'vercel',
    displayName: 'Vercel',
    getAuthorizationUrl: vi.fn().mockReturnValue({
      url: 'https://vercel.com/integrations/keyway/new?state=',
      // Integration OAuth doesn't use PKCE
    }),
    exchangeCodeForToken: vi.fn().mockResolvedValue({
      accessToken: 'vercel-access-token',
      tokenType: 'Bearer',
    }),
    getUser: vi.fn().mockResolvedValue({
      id: 'vercel-user-123',
      username: 'vercel-user',
      email: 'user@vercel.com',
    }),
    listProjects: vi.fn().mockResolvedValue([
      {
        id: 'prj_123',
        name: 'my-project',
        linkedRepo: 'testuser/test-repo',
        framework: 'nextjs',
        createdAt: new Date(),
      },
    ]),
    getProject: vi.fn().mockResolvedValue({
      id: 'prj_123',
      name: 'my-project',
      linkedRepo: 'testuser/test-repo',
    }),
    listEnvVars: vi.fn().mockResolvedValue([
      { key: 'API_KEY', value: 'secret-value', target: ['production'] },
      { key: 'DATABASE_URL', value: 'postgres://...', target: ['production'] },
    ]),
    setEnvVars: vi.fn().mockResolvedValue({ created: 1, updated: 1, failed: 0, failedKeys: [] }),
    deleteEnvVar: vi.fn().mockResolvedValue(undefined),
    deleteEnvVars: vi.fn().mockResolvedValue({ deleted: 1, failed: 0, failedKeys: [] }),
  }),
  getAvailableProviders: vi.fn().mockReturnValue([
    { name: 'vercel', displayName: 'Vercel', configured: true },
  ]),
}));

// Mock integration service functions
vi.mock('../../src/services/integration.service', () => {
  return {
    getConnection: vi.fn().mockResolvedValue(mockConnection),
    listConnections: vi.fn().mockResolvedValue([mockConnection]),
    createConnection: vi.fn().mockResolvedValue(mockConnection),
    deleteConnection: vi.fn().mockResolvedValue(true),
    listProviderProjects: vi.fn().mockResolvedValue([
      { id: 'prj_123', name: 'my-project', linkedRepo: 'testuser/test-repo' },
    ]),
    listAllProviderProjects: vi.fn().mockResolvedValue({
      projects: [
        { id: 'prj_123', name: 'my-project', linkedRepo: 'testuser/test-repo', connectionId: mockConnection.id },
      ],
      connectionCount: 1,
    }),
    getSyncStatus: vi.fn().mockResolvedValue({
      isFirstSync: true,
      vaultIsEmpty: false,
      providerHasSecrets: true,
      providerSecretCount: 2,
    }),
    getSyncPreview: vi.fn().mockResolvedValue({
      toCreate: ['NEW_VAR'],
      toUpdate: ['API_KEY'],
      toDelete: [],
      toSkip: ['DATABASE_URL'],
    }),
    executeSync: vi.fn().mockResolvedValue({
      status: 'success',
      created: 1,
      updated: 1,
      deleted: 0,
      skipped: 1,
    }),
    getConnectionToken: vi.fn().mockResolvedValue('decrypted-token'),
  };
});

// Mock services (activity logging)
vi.mock('../../src/services', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test-agent' }),
  detectPlatform: vi.fn().mockReturnValue('cli'),
}));

// Mock plan limits
vi.mock('../../src/config/plans', () => ({
  canConnectProvider: vi.fn().mockReturnValue({ allowed: true }),
}));

describe('Integration Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();

    const { integrationsRoutes } = await import('../../src/api/v1/routes/integrations.routes');
    await app.register(integrationsRoutes, { prefix: '/v1/integrations' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/integrations', () => {
    it('should return available providers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Response uses wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.data.providers).toBeInstanceOf(Array);
      expect(body.data.providers[0]).toHaveProperty('name', 'vercel');
    });
  });

  describe('GET /v1/integrations/connections', () => {
    it('should return user connections', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/connections',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Response uses wrapper format
      expect(body).toHaveProperty('data');
      expect(body.data.connections).toBeInstanceOf(Array);
    });
  });

  describe('DELETE /v1/integrations/connections/:id', () => {
    it('should delete a connection and return 204', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/integrations/connections/${mockConnection.id}`,
      });

      // DELETE returns 204 No Content
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
    });

    it('should return 404 for non-existent connection', async () => {
      const { deleteConnection } = await import('../../src/services/integration.service');
      (deleteConnection as any).mockResolvedValueOnce(false);

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/integrations/connections/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /v1/integrations/:provider/authorize', () => {
    it('should redirect to provider authorization URL', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vercel/authorize',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('vercel.com');
    });

    it('should return 404 for unknown provider', async () => {
      const { getProvider } = await import('../../src/services/providers');
      (getProvider as any).mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/unknown/authorize',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /v1/integrations/connections/:id/projects', () => {
    it('should return projects for a connection', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/integrations/connections/${mockConnection.id}/projects`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Response uses wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.data.projects).toBeInstanceOf(Array);
      expect(body.data.projects[0]).toHaveProperty('id', 'prj_123');
    });
  });

  describe('Sync routes validation', () => {
    it('should validate required query params for sync/status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vaults/testuser/test-repo/sync/status',
        // Missing required query params
      });

      // Should fail validation (400) or auth (depends on order)
      expect([400, 500]).toContain(response.statusCode);
    });

    it('should validate required query params for sync/preview', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vaults/testuser/test-repo/sync/preview',
        // Missing required query params
      });

      // Should fail validation
      expect([400, 500]).toContain(response.statusCode);
    });

    it('should validate required body params for sync', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/vaults/testuser/test-repo/sync',
        payload: {
          // Missing required fields
        },
      });

      // Should fail validation
      expect([400, 500]).toContain(response.statusCode);
    });

    it('should validate connectionId is UUID for sync/preview', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vaults/testuser/test-repo/sync/preview',
        query: {
          connectionId: 'not-a-uuid',
          projectId: 'prj_123',
          keywayEnvironment: 'production',
          providerEnvironment: 'production',
        },
      });

      // Should fail UUID validation
      expect([400, 500]).toContain(response.statusCode);
    });

    it('should validate connectionId is UUID for sync POST', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/vaults/testuser/test-repo/sync',
        payload: {
          connectionId: 'not-a-uuid',
          projectId: 'prj_123',
          keywayEnvironment: 'production',
          providerEnvironment: 'production',
          direction: 'push',
        },
      });

      // Should fail UUID validation
      expect([400, 500]).toContain(response.statusCode);
    });

    it('should validate direction enum for sync POST', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/vaults/testuser/test-repo/sync',
        payload: {
          connectionId: '00000000-0000-0000-0000-000000000000',
          projectId: 'prj_123',
          keywayEnvironment: 'production',
          providerEnvironment: 'production',
          direction: 'invalid-direction', // Should be 'push' or 'pull'
        },
      });

      // Should fail enum validation
      expect([400, 500]).toContain(response.statusCode);
    });
  });
});

describe('Vercel Provider OAuth Callback', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });

    const { integrationsRoutes } = await import('../../src/api/v1/routes/integrations.routes');
    await app.register(integrationsRoutes, { prefix: '/v1/integrations' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/integrations/:provider/callback', () => {
    it('should handle OAuth error from provider', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vercel/callback',
        query: {
          error: 'access_denied',
          error_description: 'User denied access',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Authorization Denied');
    });

    it('should return 400 for missing code or state', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vercel/callback',
        query: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle successful OAuth callback', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vercel/callback',
        query: {
          code: 'auth-code-123',
          state: 'signed-state-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Connected');
    });

    it('should handle invalid state', async () => {
      const { verifyState } = await import('../../src/utils/state');
      (verifyState as any).mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/vercel/callback',
        query: {
          code: 'auth-code-123',
          state: 'invalid-state',
        },
      });

      // Should return HTML error page (not a JSON error)
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Connection Failed');
    });
  });
});
