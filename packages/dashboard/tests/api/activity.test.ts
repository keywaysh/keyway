import { describe, it, expect, vi, beforeEach } from 'vitest'
import { activityApi } from '../../lib/api/activity'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('activityApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getActivity', () => {
    it('should fetch activity events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'secret_created',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: 'https://avatar.png' },
              platform: 'web',
              metadata: { secretName: 'API_KEY', environment: 'production' },
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/activity?limit=100'),
        expect.any(Object)
      )
      expect(result).toHaveLength(1)
      expect(result[0].action).toBe('secret_created')
      expect(result[0].category).toBe('secrets')
      expect(result[0].vault_name).toBe('owner/repo')
      expect(result[0].user_name).toBe('testuser')
      expect(result[0].secret_name).toBe('API_KEY')
      expect(result[0].environment).toBe('production')
    })

    it('should map action to category correctly for vaults', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'vault_created',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'cli',
              metadata: null,
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('vaults')
      expect(result[0].user_avatar).toBe('')
    })

    it('should map action to category for environments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'environment_created',
              vaultId: null,
              repoFullName: null,
              actor: { id: 'user-1', username: 'testuser', avatarUrl: 'https://avatar.png' },
              platform: 'web',
              metadata: { environment: 'staging' },
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('environments')
      expect(result[0].vault_id).toBe('')
      expect(result[0].vault_name).toBe('')
    })

    it('should map action to category for access events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'secrets_pulled',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'api',
              metadata: { count: 5 },
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('access')
      expect(result[0].count).toBe(5)
    })

    it('should map action to category for integrations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'integration_connected',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'web',
              metadata: null,
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('integrations')
    })

    it('should map action to category for billing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'plan_upgraded',
              vaultId: null,
              repoFullName: null,
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'web',
              metadata: null,
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('billing')
    })

    it('should map action to category for account', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'user_login',
              vaultId: null,
              repoFullName: null,
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'web',
              metadata: null,
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('account')
    })

    it('should default to secrets category for unknown actions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'unknown_action',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'cli',
              metadata: null,
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].category).toBe('secrets')
    })

    it('should handle metadata.key as secret_name fallback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'event-1',
              action: 'secret_created',
              vaultId: 'vault-1',
              repoFullName: 'owner/repo',
              actor: { id: 'user-1', username: 'testuser', avatarUrl: null },
              platform: 'web',
              metadata: { key: 'DATABASE_URL' },
              timestamp: '2025-01-01T12:00:00Z',
            },
          ],
          meta: {
            requestId: 'req-1',
            pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
          },
        }),
      })

      const result = await activityApi.getActivity()

      expect(result[0].secret_name).toBe('DATABASE_URL')
    })
  })
})
