import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiKeysApi } from '../../lib/api/api-keys'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('apiKeysApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getApiKeys', () => {
    it('should fetch all API keys', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            keys: [
              {
                id: 'key-1',
                name: 'Production Key',
                prefix: 'kw_live_abc',
                created_at: '2025-01-01T00:00:00Z',
                last_used_at: '2025-01-02T00:00:00Z',
                expires_at: null,
              },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await apiKeysApi.getApiKeys()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/api-keys'),
        expect.objectContaining({
          credentials: 'include',
        })
      )
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Production Key')
    })
  })

  describe('getApiKey', () => {
    it('should fetch a single API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: 'key-1',
            name: 'Production Key',
            prefix: 'kw_live_abc',
            created_at: '2025-01-01T00:00:00Z',
            last_used_at: null,
            expires_at: null,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await apiKeysApi.getApiKey('key-1')

      expect(result.id).toBe('key-1')
      expect(result.name).toBe('Production Key')
    })
  })

  describe('createApiKey', () => {
    it('should create a new API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          data: {
            key: {
              id: 'key-new',
              name: 'New Key',
              prefix: 'kw_live_xyz',
              created_at: '2025-01-01T00:00:00Z',
              last_used_at: null,
              expires_at: null,
            },
            token: 'kw_live_xyz123456789',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await apiKeysApi.createApiKey({ name: 'New Key' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/api-keys'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(result.token).toBe('kw_live_xyz123456789')
      expect(result.key.name).toBe('New Key')
    })
  })

  describe('revokeApiKey', () => {
    it('should revoke an API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      await apiKeysApi.revokeApiKey('key-1')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/api-keys/key-1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })
})
