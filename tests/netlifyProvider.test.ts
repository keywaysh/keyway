import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock config before importing provider
vi.mock('../src/config', () => ({
  config: {
    server: { isDevelopment: false },
    netlify: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
  },
}));

describe('Netlify Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('should return correct OAuth authorization URL', async () => {
      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = netlifyProvider.getAuthorizationUrl('test-state', 'http://localhost:3000/callback');

      expect(result).toHaveProperty('url');
      expect(result.url).toContain('https://app.netlify.com/authorize');
      expect(result.url).toContain('client_id=test-client-id');
      expect(result.url).toContain('response_type=code');
      expect(result.url).toContain('redirect_uri=');
      expect(result.url).toContain('state=test-state');
      expect(result.codeVerifier).toBeUndefined();
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should exchange code for access token using form-urlencoded body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'netlify-access-token',
          token_type: 'Bearer',
          refresh_token: 'netlify-refresh-token',
        }),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = await netlifyProvider.exchangeCodeForToken('auth-code', 'http://localhost:3000/callback');

      expect(result.accessToken).toBe('netlify-access-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.refreshToken).toBe('netlify-refresh-token');

      // Should use the OAuth token endpoint with form-urlencoded
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.netlify.com/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );

      // Verify the body contains correct params
      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('client_id')).toBe('test-client-id');
      expect(body.get('client_secret')).toBe('test-client-secret');
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

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await expect(netlifyProvider.exchangeCodeForToken('invalid-code', 'http://localhost:3000/callback'))
        .rejects.toThrow('Invalid authorization code');
    });
  });

  describe('getUser', () => {
    it('should fetch user info from /api/v1/user endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'user-123',
          slug: 'testuser',
          full_name: 'Test User',
          email: 'test@netlify.com',
          avatar_url: 'https://netlify.com/avatar/123',
        }),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const user = await netlifyProvider.getUser('access-token');

      expect(user.id).toBe('user-123');
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@netlify.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.netlify.com/api/v1/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
          }),
        })
      );
    });

    it('should fallback to full_name if slug is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'user-123',
          slug: '',
          full_name: 'Test User',
          email: 'test@netlify.com',
        }),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const user = await netlifyProvider.getUser('access-token');

      expect(user.username).toBe('Test User');
    });
  });

  describe('listProjects', () => {
    it('should list user sites', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 'site-123',
            name: 'my-site',
            url: 'https://my-site.netlify.app',
            build_settings: {
              repo_url: 'https://github.com/testuser/my-repo.git',
            },
          },
          {
            id: 'site-456',
            name: 'another-site',
            url: 'https://another-site.netlify.app',
          },
        ]),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const projects = await netlifyProvider.listProjects('access-token');

      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe('site-123');
      expect(projects[0].name).toBe('my-site');
      expect(projects[0].linkedRepo).toBe('testuser/my-repo');
      expect(projects[1].linkedRepo).toBeUndefined();
    });

    it('should strip .git suffix from repo URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 'site-123',
            name: 'my-site',
            build_settings: {
              repo_url: 'https://github.com/testuser/my-repo.git',
            },
          },
        ]),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const projects = await netlifyProvider.listProjects('access-token');

      expect(projects[0].linkedRepo).toBe('testuser/my-repo');
    });
  });

  describe('listEnvVars', () => {
    it('should list environment variables for target context', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            key: 'API_KEY',
            scopes: ['builds', 'functions', 'runtime'],
            values: [
              { id: 'val1', value: 'prod-secret', context: 'production' },
              { id: 'val2', value: 'dev-secret', context: 'dev' },
            ],
            is_secret: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
          {
            key: 'DEBUG',
            scopes: ['builds'],
            values: [
              { id: 'val3', value: 'true', context: 'dev' },
            ],
            is_secret: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const envVars = await netlifyProvider.listEnvVars('access-token', 'site-123', 'production');

      expect(envVars).toHaveLength(1);
      expect(envVars[0].key).toBe('API_KEY');
      expect(envVars[0].value).toBe('prod-secret');
    });

    it('should filter out system variables (NETLIFY_*)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            key: 'DATABASE_URL',
            values: [{ id: 'val1', value: 'postgres://...', context: 'production' }],
            is_secret: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
          {
            key: 'NETLIFY_IMAGES_CDN_DOMAIN',
            values: [{ id: 'val2', value: 'images.netlify.app', context: 'production' }],
            is_secret: false,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const envVars = await netlifyProvider.listEnvVars('access-token', 'site-123', 'production');

      expect(envVars).toHaveLength(1);
      expect(envVars[0].key).toBe('DATABASE_URL');
    });

    it('should include is_secret vars with undefined value', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            key: 'SECRET_KEY',
            values: [{ id: 'val1', value: 'hidden', context: 'production' }],
            is_secret: true,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const envVars = await netlifyProvider.listEnvVars('access-token', 'site-123', 'production');

      expect(envVars).toHaveLength(1);
      expect(envVars[0].key).toBe('SECRET_KEY');
      expect(envVars[0].value).toBeUndefined();
      expect(envVars[0].type).toBe('secret');
    });
  });

  describe('setEnvVars', () => {
    it('should bulk create new env vars', async () => {
      // First call: get existing env vars (empty)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      // Second call: bulk create env vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { key: 'NEW_VAR1' },
          { key: 'NEW_VAR2' },
        ]),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = await netlifyProvider.setEnvVars('access-token', 'site-123', 'production', {
        NEW_VAR1: 'value1',
        NEW_VAR2: 'value2',
      });

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);

      // Verify bulk create was called
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'https://api.netlify.com/api/v1/sites/site-123/env',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should update existing env vars with PATCH', async () => {
      // First call: get existing env vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { key: 'EXISTING_VAR', values: [{ context: 'production', value: 'old' }] },
        ]),
      });
      // Second call: PATCH existing var
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = await netlifyProvider.setEnvVars('access-token', 'site-123', 'production', {
        EXISTING_VAR: 'updated-value',
      });

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      // Verify PATCH was called with /value endpoint
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'https://api.netlify.com/api/v1/sites/site-123/env/EXISTING_VAR/value',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });

    it('should handle mixed create and update', async () => {
      // First call: get existing env vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { key: 'EXISTING', values: [{ context: 'production', value: 'old' }] },
        ]),
      });
      // Second call: bulk create new vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ key: 'NEW_VAR' }]),
      });
      // Third call: PATCH existing var
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = await netlifyProvider.setEnvVars('access-token', 'site-123', 'production', {
        NEW_VAR: 'new-value',
        EXISTING: 'updated-value',
      });

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
    });
  });

  describe('deleteEnvVar', () => {
    it('should delete specific context value, not entire var', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await netlifyProvider.deleteEnvVar('access-token', 'site-123', 'production', 'TO_DELETE');

      // Should use the value-specific endpoint with context query param
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.netlify.com/api/v1/sites/site-123/env/TO_DELETE/value?context=production',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should URL-encode special characters in key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await netlifyProvider.deleteEnvVar('access-token', 'site-123', 'production', 'MY_VAR/TEST');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('MY_VAR%2FTEST'),
        expect.any(Object)
      );
    });
  });

  describe('deleteEnvVars', () => {
    it('should delete multiple env vars', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = await netlifyProvider.deleteEnvVars!('access-token', 'site-123', 'production', ['VAR1', 'VAR2']);

      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should track failures and continue', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not_found' }) });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const result = await netlifyProvider.deleteEnvVars!('access-token', 'site-123', 'production', ['VAR1', 'VAR2']);

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failedKeys).toContain('VAR2');
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

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await expect(netlifyProvider.getUser('access-token'))
        .rejects.toThrow(/rate limited/i);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await expect(netlifyProvider.getUser('access-token'))
        .rejects.toThrow(/network error/i);
    });

    it('should handle timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await expect(netlifyProvider.getUser('access-token'))
        .rejects.toThrow(/timed out/i);
    });

    it('should handle invalid JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      await expect(netlifyProvider.getUser('access-token'))
        .rejects.toThrow(/invalid response/i);
    });
  });

  describe('getProject', () => {
    it('should fetch a specific site by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'site-123',
          name: 'my-site',
          url: 'https://my-site.netlify.app',
          build_settings: {
            repo_url: 'https://github.com/testuser/my-repo',
          },
        }),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const project = await netlifyProvider.getProject!('access-token', 'site-123');

      expect(project).not.toBeNull();
      expect(project!.id).toBe('site-123');
      expect(project!.name).toBe('my-site');
      expect(project!.linkedRepo).toBe('testuser/my-repo');
    });

    it('should return null for non-existent site', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'not_found' }),
      });

      const { netlifyProvider } = await import('../src/services/providers/netlify.provider');

      const project = await netlifyProvider.getProject!('access-token', 'non-existent');

      expect(project).toBeNull();
    });
  });
});
