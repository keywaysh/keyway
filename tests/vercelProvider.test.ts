import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock config before importing provider
vi.mock('../src/config', () => ({
  config: {
    server: { isDevelopment: false },
    vercel: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
  },
}));

describe('Vercel Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('should return correct authorization URL', async () => {
      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const url = vercelProvider.getAuthorizationUrl('test-state', 'http://localhost:3000/callback');

      expect(url).toContain('vercel.com/integrations/install/new');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('state=test-state');
      expect(url).toContain('redirect_uri=');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should exchange code for access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'vercel-access-token',
          token_type: 'Bearer',
        }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const result = await vercelProvider.exchangeCodeForToken('auth-code', 'http://localhost:3000/callback');

      expect(result.accessToken).toBe('vercel-access-token');
      expect(result.tokenType).toBe('Bearer');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vercel.com/v2/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw error on failed token exchange', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'Invalid authorization code',
        }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await expect(vercelProvider.exchangeCodeForToken('invalid-code', 'http://localhost:3000/callback'))
        .rejects.toThrow('Invalid authorization code');
    });
  });

  describe('getUser', () => {
    it('should fetch user info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          user: {
            id: 'user-123',
            username: 'testuser',
            email: 'test@vercel.com',
            name: 'Test User',
          },
        }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const user = await vercelProvider.getUser('access-token');

      expect(user.id).toBe('user-123');
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@vercel.com');
    });
  });

  describe('listProjects', () => {
    it('should list user projects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          projects: [
            {
              id: 'prj_123',
              name: 'my-project',
              framework: 'nextjs',
              createdAt: Date.now(),
              link: { type: 'github', org: 'testuser', repo: 'my-repo' },
            },
            {
              id: 'prj_456',
              name: 'another-project',
              createdAt: Date.now(),
            },
          ],
        }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const projects = await vercelProvider.listProjects('access-token');

      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe('prj_123');
      expect(projects[0].linkedRepo).toBe('testuser/my-repo');
      expect(projects[1].linkedRepo).toBeUndefined();
    });

    it('should include teamId in query when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ projects: [] }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await vercelProvider.listProjects('access-token', 'team_123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('teamId=team_123'),
        expect.any(Object)
      );
    });
  });

  describe('listEnvVars', () => {
    it('should list environment variables for target environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          envs: [
            { id: 'env1', key: 'API_KEY', value: 'secret', target: ['production'], type: 'encrypted', createdAt: Date.now(), updatedAt: Date.now() },
            { id: 'env2', key: 'DEBUG', value: 'true', target: ['development'], type: 'plain', createdAt: Date.now(), updatedAt: Date.now() },
            { id: 'env3', key: 'SHARED', value: 'shared', target: ['production', 'development'], type: 'plain', createdAt: Date.now(), updatedAt: Date.now() },
          ],
        }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const envVars = await vercelProvider.listEnvVars('access-token', 'prj_123', 'production');

      expect(envVars).toHaveLength(2);
      expect(envVars.map(e => e.key)).toEqual(['API_KEY', 'SHARED']);
    });
  });

  describe('setEnvVars', () => {
    it('should create new env vars', async () => {
      // First call: get existing env vars (empty)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ envs: [] }),
      });
      // Second call: create env var
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'env1', key: 'NEW_VAR' }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const result = await vercelProvider.setEnvVars('access-token', 'prj_123', 'production', {
        NEW_VAR: 'new-value',
      });

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('should update existing env vars', async () => {
      // First call: get existing env vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          envs: [
            { id: 'env1', key: 'EXISTING_VAR', target: ['production'] },
          ],
        }),
      });
      // Second call: update env var
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'env1' }),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      const result = await vercelProvider.setEnvVars('access-token', 'prj_123', 'production', {
        EXISTING_VAR: 'updated-value',
      });

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
    });
  });

  describe('deleteEnvVar', () => {
    it('should delete env var entirely when only one target', async () => {
      // Get existing env vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          envs: [
            { id: 'env1', key: 'TO_DELETE', target: ['production'] },
          ],
        }),
      });
      // Delete env var
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await vercelProvider.deleteEnvVar('access-token', 'prj_123', 'production', 'TO_DELETE');

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/env/env1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should only remove target when env var has multiple targets', async () => {
      // Get existing env vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          envs: [
            { id: 'env1', key: 'MULTI_TARGET', target: ['production', 'preview'] },
          ],
        }),
      });
      // Patch to remove target
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await vercelProvider.deleteEnvVar('access-token', 'prj_123', 'production', 'MULTI_TARGET');

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/env/env1'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  describe('error handling', () => {
    it('should handle rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => name === 'Retry-After' ? '60' : null,
        },
        json: () => Promise.resolve({}),
      });

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await expect(vercelProvider.getUser('access-token'))
        .rejects.toThrow(/rate limited/i);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await expect(vercelProvider.getUser('access-token'))
        .rejects.toThrow(/network error/i);
    });

    it('should handle timeout', async () => {
      // Mock AbortError
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { vercelProvider } = await import('../src/services/providers/vercel.provider');

      await expect(vercelProvider.getUser('access-token'))
        .rejects.toThrow(/timed out/i);
    });
  });
});
