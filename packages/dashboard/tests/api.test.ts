import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the API client by mocking fetch
describe('ApiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('request handling', () => {
    it('should set Content-Type only when body is present', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [],
          meta: { requestId: 'req-1', pagination: { total: 0, limit: 20, offset: 0, hasMore: false } },
        }),
      });
      global.fetch = mockFetch;

      // Import fresh to get clean module
      const { api } = await import('../lib/api');

      // GET request (no body)
      await api.getVaults();

      const getCall = mockFetch.mock.calls[0];
      expect(getCall[1].headers['Content-Type']).toBeUndefined();
    });

    it('should set Content-Type for POST requests with body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: '123', status: 'created' }, meta: { requestId: 'req-1' } }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');

      await api.createSecretByRepo('owner', 'repo', {
        name: 'TEST_KEY',
        value: 'test-value',
        environment: 'default',
      });

      const postCall = mockFetch.mock.calls[0];
      expect(postCall[1].headers['Content-Type']).toBe('application/json');
      expect(postCall[1].body).toBeDefined();
    });

    it('should NOT set Content-Type for DELETE requests without body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');

      await api.deleteVault('owner', 'repo');

      const deleteCall = mockFetch.mock.calls[0];
      expect(deleteCall[1].method).toBe('DELETE');
      expect(deleteCall[1].headers['Content-Type']).toBeUndefined();
      expect(deleteCall[1].body).toBeUndefined();
    });

    it('should include credentials in requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [],
          meta: { requestId: 'req-1', pagination: { total: 0, limit: 20, offset: 0, hasMore: false } },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      await api.getVaults();

      expect(mockFetch.mock.calls[0][1].credentials).toBe('include');
    });

    it('should throw error on non-ok response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Vault not found' }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');

      await expect(api.getVaultByRepo('owner', 'nonexistent')).rejects.toThrow('Vault not found');
    });

    it('should handle JSON parse errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');

      await expect(api.getVaults()).rejects.toThrow('Request failed');
    });
  });

  describe('data transformation', () => {
    it('should transform vault response to frontend format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{
            id: 'vault-123',
            repoOwner: 'my-org',
            repoName: 'my-repo',
            repoAvatar: 'https://example.com/avatar.png',
            secretCount: 5,
            environments: ['default', 'production'],
            permission: 'admin',
            isPrivate: false,
            isReadOnly: false,
            readonlyReason: null,
            syncs: [],
            updatedAt: '2024-01-01T00:00:00Z',
          }],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
          },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const vaults = await api.getVaults();

      expect(vaults).toHaveLength(1);
      expect(vaults[0]).toEqual({
        id: 'vault-123',
        repo_name: 'my-repo',
        repo_owner: 'my-org',
        repo_avatar: 'https://example.com/avatar.png',
        secrets_count: 5,
        environments: ['default', 'production'],
        permission: 'admin',
        is_private: false,
        is_read_only: false,
        readonly_reason: null,
        syncs: [],
        updated_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      });
    });

    it('should transform user response to frontend format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            id: 'user-123',
            githubId: 12345,
            username: 'testuser',
            email: 'test@example.com',
            avatarUrl: 'https://example.com/avatar.png',
            createdAt: '2024-01-01T00:00:00Z',
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const user = await api.getMe();

      expect(user).toEqual({
        id: 'user-123',
        name: 'testuser',
        email: 'test@example.com',
        avatar_url: 'https://example.com/avatar.png',
        github_username: 'testuser',
        plan: 'free',
        created_at: '2024-01-01T00:00:00Z',
      });
    });

    it('should transform secrets response to frontend format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{
            id: 'secret-123',
            key: 'DATABASE_URL',
            environment: 'production',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-15T00:00:00Z',
          }],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
          },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const secrets = await api.getSecretsByRepo('owner', 'repo');

      expect(secrets).toHaveLength(1);
      expect(secrets[0]).toEqual({
        id: 'secret-123',
        name: 'DATABASE_URL',
        environment: 'production',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        last_modified_by: null,
      });
    });

    it('should transform activity response with action mapping', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'act-1',
              action: 'secrets_pulled',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
              platform: 'cli',
              metadata: null,
              timestamp: '2024-01-01T00:00:00Z',
            },
            {
              id: 'act-2',
              action: 'secret_created',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'web',
              metadata: null,
              timestamp: '2024-01-02T00:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 2, limit: 20, offset: 0, hasMore: false },
          },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const activity = await api.getActivity();

      expect(activity).toHaveLength(2);
      expect(activity[0].category).toBe('access');  // secrets_pulled -> access
      expect(activity[1].category).toBe('secrets'); // secret_created -> secrets
    });
  });

  describe('trash operations', () => {
    it('should get trashed secrets for a vault', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{
            id: 'secret-123',
            key: 'OLD_API_KEY',
            environment: 'production',
            deletedAt: '2024-01-01T00:00:00Z',
            expiresAt: '2024-01-31T00:00:00Z',
            daysRemaining: 25,
          }],
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const trashed = await api.getTrashedSecrets('owner', 'repo');

      expect(trashed).toHaveLength(1);
      // name is transformed from key, deletedAt/expiresAt/daysRemaining are preserved
      expect(trashed[0]).toMatchObject({
        id: 'secret-123',
        name: 'OLD_API_KEY',
        environment: 'production',
        deleted_at: '2024-01-01T00:00:00Z',
        expires_at: '2024-01-31T00:00:00Z',
        days_remaining: 25,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/vaults/owner/repo/trash'),
        expect.any(Object)
      );
    });

    it('should restore a secret from trash', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            id: 'secret-123',
            key: 'RESTORED_KEY',
            environment: 'production',
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const restored = await api.restoreSecret('owner', 'repo', 'secret-123');

      expect(restored).toMatchObject({
        id: 'secret-123',
        name: 'RESTORED_KEY',
        environment: 'production',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/vaults/owner/repo/trash/secret-123/restore'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should permanently delete a secret from trash', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      await api.permanentlyDeleteSecret('owner', 'repo', 'secret-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/vaults/owner/repo/trash/secret-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should empty trash for a vault', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: { deleted: 3 },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const result = await api.emptyTrash('owner', 'repo');

      expect(result.deleted).toBe(3);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/vaults/owner/repo/trash'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should soft-delete a secret (move to trash)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            id: 'secret-123',
            key: 'API_KEY',
            environment: 'production',
            deletedAt: '2024-01-01T00:00:00Z',
            expiresAt: '2024-01-31T00:00:00Z',
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      await api.deleteSecretByRepo('owner', 'repo', 'secret-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/vaults/owner/repo/secrets/secret-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('sync operations', () => {
    it('should get sync preview with correct parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            toCreate: ['NEW_VAR'],
            toUpdate: ['UPDATED_VAR'],
            toDelete: [],
            toSkip: ['EXISTING_VAR'],
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const preview = await api.getSyncPreview(
        'owner',
        'repo',
        'conn-123',
        'prj-456',
        'production',
        'preview'
      );

      expect(preview).toEqual({
        toCreate: ['NEW_VAR'],
        toUpdate: ['UPDATED_VAR'],
        toDelete: [],
        toSkip: ['EXISTING_VAR'],
      });

      // Verify URL includes all query parameters
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/vaults/owner/repo/sync/preview');
      expect(calledUrl).toContain('connectionId=conn-123');
      expect(calledUrl).toContain('projectId=prj-456');
      expect(calledUrl).toContain('keywayEnvironment=production');
      expect(calledUrl).toContain('providerEnvironment=preview');
      expect(calledUrl).toContain('direction=push');
      expect(calledUrl).toContain('allowDelete=false');
    });

    it('should execute sync with correct body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            status: 'success',
            created: 2,
            updated: 1,
            deleted: 0,
            skipped: 3,
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const result = await api.executeSync(
        'owner',
        'repo',
        'conn-123',
        'prj-456',
        'production',
        'preview'
      );

      expect(result).toEqual({
        status: 'success',
        created: 2,
        updated: 1,
        deleted: 0,
        skipped: 3,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/vaults/owner/repo/sync'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            connectionId: 'conn-123',
            projectId: 'prj-456',
            keywayEnvironment: 'production',
            providerEnvironment: 'preview',
            direction: 'push',
            allowDelete: false,
          }),
        })
      );
    });

    it('should return error status from sync result', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            status: 'error',
            created: 0,
            updated: 0,
            deleted: 0,
            skipped: 0,
            error: 'Provider API rate limit exceeded',
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const result = await api.executeSync(
        'owner',
        'repo',
        'conn-123',
        'prj-456',
        'production',
        'production'
      );

      expect(result.status).toBe('error');
      expect(result.error).toBe('Provider API rate limit exceeded');
    });

    it('should handle partial sync status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            status: 'partial',
            created: 1,
            updated: 0,
            deleted: 0,
            skipped: 2,
            error: 'Some secrets failed to sync',
          },
          meta: { requestId: 'req-1' },
        }),
      });
      global.fetch = mockFetch;

      const { api } = await import('../lib/api');
      const result = await api.executeSync(
        'owner',
        'repo',
        'conn-123',
        'prj-456',
        'staging',
        'staging'
      );

      expect(result.status).toBe('partial');
      expect(result.created).toBe(1);
      expect(result.error).toBe('Some secrets failed to sync');
    });
  });
});
