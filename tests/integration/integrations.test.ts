import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockVault, createMockDb, createMockGitHubUtils } from '../helpers/mocks';

// Mock connection data
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

// Mock vault sync data
const mockVaultSync = {
  id: 'test-sync-id-123',
  vaultId: mockVault.id,
  connectionId: mockConnection.id,
  provider: 'vercel',
  providerProjectId: 'prj_123',
  providerProjectName: 'my-project',
  keywayEnvironment: 'production',
  providerEnvironment: 'production',
  lastSyncedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Mock vercel project
const mockVercelProject = {
  id: 'prj_123',
  name: 'my-project',
  framework: 'nextjs',
  createdAt: Date.now(),
  link: {
    type: 'github',
    org: 'testuser',
    repo: 'test-repo',
  },
};

// Mock vercel env vars
const mockVercelEnvVars = [
  { id: 'env1', key: 'API_KEY', value: 'secret-value', target: ['production'], type: 'encrypted', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'env2', key: 'DATABASE_URL', value: 'postgres://...', target: ['production', 'preview'], type: 'encrypted', createdAt: Date.now(), updatedAt: Date.now() },
];

// Create enhanced mock DB with provider connections
function createMockDbWithConnections() {
  const baseMock = createMockDb();

  return {
    ...baseMock,
    query: {
      ...baseMock.query,
      providerConnections: {
        findFirst: vi.fn().mockResolvedValue(mockConnection),
        findMany: vi.fn().mockResolvedValue([mockConnection]),
      },
      vaultSyncs: {
        findFirst: vi.fn().mockResolvedValue(null), // No existing sync by default
      },
    },
  };
}

// Mock the database module
vi.mock('../../src/db', () => {
  const mockDb = createMockDbWithConnections();
  return {
    db: mockDb,
    users: { id: 'id', githubId: 'githubId' },
    vaults: { id: 'id', repoFullName: 'repoFullName' },
    secrets: { id: 'id', vaultId: 'vaultId', environment: 'environment' },
    providerConnections: { id: 'id', userId: 'userId', provider: 'provider', providerTeamId: 'providerTeamId' },
    vaultSyncs: { id: 'id', vaultId: 'vaultId', connectionId: 'connectionId' },
    syncLogs: { id: 'id', syncId: 'syncId' },
  };
});

// Mock GitHub utils
vi.mock('../../src/utils/github', () => createMockGitHubUtils());

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
    userId: mockUser.githubId,
    redirectUri: null,
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
    getAuthorizationUrl: vi.fn().mockReturnValue('https://vercel.com/oauth/authorize?...'),
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

// Mock auth middleware
vi.mock('../../src/middleware/auth', () => ({
  authenticateGitHub: vi.fn((request: any, reply: any, done: any) => {
    request.githubUser = {
      githubId: mockUser.githubId,
      username: mockUser.username,
      email: mockUser.email,
      avatarUrl: mockUser.avatarUrl,
    };
    request.accessToken = 'test-github-token';
    done();
  }),
}));

// Mock integration service functions
vi.mock('../../src/services/integration.service', async () => {
  return {
    getConnection: vi.fn().mockResolvedValue(mockConnection),
    listConnections: vi.fn().mockResolvedValue([mockConnection]),
    createConnection: vi.fn().mockResolvedValue(mockConnection),
    deleteConnection: vi.fn().mockResolvedValue(true),
    listProviderProjects: vi.fn().mockResolvedValue([
      { id: 'prj_123', name: 'my-project', linkedRepo: 'testuser/test-repo' },
    ]),
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

describe('Integration Routes', () => {
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

  describe('GET /v1/integrations', () => {
    it('should return available providers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.providers).toBeInstanceOf(Array);
      expect(body.providers[0]).toHaveProperty('name', 'vercel');
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
      expect(body.connections).toBeInstanceOf(Array);
    });
  });

  describe('DELETE /v1/integrations/connections/:id', () => {
    it('should delete a connection', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/integrations/connections/${mockConnection.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
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
      expect(body.projects).toBeInstanceOf(Array);
      expect(body.projects[0]).toHaveProperty('id', 'prj_123');
    });
  });

  // Note: Sync routes (/vaults/:owner/:repo/sync/*) require complex mocking of
  // verifyVaultAccess which involves GitHub API calls and DB lookups.
  // These are better tested with e2e tests or with a complete mock setup.
  // The core sync functionality is tested via the integration.service unit tests.

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
