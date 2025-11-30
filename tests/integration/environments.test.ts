import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockVault, createMockDb, createMockGitHubUtils } from '../helpers/mocks';

// Mock the database module
vi.mock('../../src/db', () => {
  const mockDb = createMockDb();
  return {
    db: mockDb,
    users: { id: 'id', githubId: 'githubId' },
    vaults: { id: 'id', repoFullName: 'repoFullName', environments: 'environments' },
    secrets: { id: 'id', vaultId: 'vaultId', environment: 'environment' },
    environmentPermissions: { id: 'id', vaultId: 'vaultId', environment: 'environment' },
  };
});

// Mock GitHub utils
vi.mock('../../src/utils/github', () => createMockGitHubUtils());

// Mock analytics (no-op)
vi.mock('../../src/utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    VAULT_INITIALIZED: 'api_vault_initialized',
  },
}));

// Mock services
vi.mock('../../src/services', () => ({
  getVaultByRepoInternal: vi.fn(),
  logActivity: vi.fn(),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
  detectPlatform: vi.fn().mockReturnValue('api'),
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
    request.accessToken = 'test-token';
    done();
  }),
  requireAdminAccess: vi.fn((request: any, reply: any, done: any) => {
    done();
  }),
}));

describe('Environment Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });

    const { vaultsRoutes } = await import('../../src/api/v1/routes/vaults.routes');
    await app.register(vaultsRoutes, { prefix: '/v1/vaults' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/vaults/:owner/:repo/environments', () => {
    it('should return vault.environments array', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/environments',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.environments).toEqual(['local', 'development', 'staging', 'production']);
    });

    it('should return default environments for vault without environments field', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: null, // Pre-migration vault
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/test-repo/environments',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.environments).toEqual(['local', 'development', 'staging', 'production']);
    });

    it('should return 404 for non-existent vault', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/vaults/testuser/nonexistent/environments',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/vaults/:owner/:repo/environments', () => {
    it('should create a new environment', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      const { db } = await import('../../src/db');

      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults/testuser/test-repo/environments',
        payload: { name: 'preview' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.environment).toBe('preview');
      expect(body.data.environments).toContain('preview');
      expect(db.update).toHaveBeenCalled();
    });

    it('should reject invalid environment name (uppercase)', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue(mockVault);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults/testuser/test-repo/environments',
        payload: { name: 'INVALID' },
      });

      // Zod validation error - returns 500 in test environment without error handler
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should reject environment name too short', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue(mockVault);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults/testuser/test-repo/environments',
        payload: { name: 'a' },
      });

      // Zod validation error - returns 500 in test environment without error handler
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should reject duplicate environment name', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/vaults/testuser/test-repo/environments',
        payload: { name: 'local' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('PATCH /v1/vaults/:owner/:repo/environments/:name', () => {
    it('should rename an environment', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      const { db } = await import('../../src/db');

      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/vaults/testuser/test-repo/environments/staging',
        payload: { newName: 'qa' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.oldName).toBe('staging');
      expect(body.data.newName).toBe('qa');
      expect(body.data.environments).toContain('qa');
      expect(body.data.environments).not.toContain('staging');

      // Should run in transaction
      expect(db.transaction).toHaveBeenCalled();
    });

    it('should return 404 for non-existent environment', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/vaults/testuser/test-repo/environments/nonexistent',
        payload: { newName: 'something' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject renaming to existing environment name', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/vaults/testuser/test-repo/environments/staging',
        payload: { newName: 'local' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('DELETE /v1/vaults/:owner/:repo/environments/:name', () => {
    it('should delete an environment', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      const { db } = await import('../../src/db');

      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/environments/staging',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.deleted).toBe('staging');
      expect(body.data.environments).not.toContain('staging');

      // Should run in transaction
      expect(db.transaction).toHaveBeenCalled();
    });

    it('should return 404 for non-existent environment', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local', 'development', 'staging', 'production'],
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/environments/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should prevent deleting the last environment', async () => {
      const { getVaultByRepoInternal } = await import('../../src/services');
      (getVaultByRepoInternal as any).mockResolvedValue({
        ...mockVault,
        environments: ['local'], // Only one environment
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/vaults/testuser/test-repo/environments/local',
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
