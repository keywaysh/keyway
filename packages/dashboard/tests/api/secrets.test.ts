import { describe, it, expect, vi, beforeEach } from 'vitest'
import { secretsApi } from '../../lib/api/secrets'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('secretsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSecretsByRepo', () => {
    it('should fetch secrets for a repo', async () => {
      const mockSecretsResponse = {
        data: [
          { id: '1', key: 'API_KEY', environment: 'production', createdAt: '2025-01-01', updatedAt: '2025-01-01', lastModifiedBy: null },
          { id: '2', key: 'DB_URL', environment: 'staging', createdAt: '2025-01-01', updatedAt: '2025-01-01', lastModifiedBy: null },
        ],
        meta: { requestId: 'req-1', pagination: { total: 2, limit: 100, offset: 0, hasMore: false } },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSecretsResponse),
      })

      const result = await secretsApi.getSecretsByRepo('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/secrets'),
        expect.objectContaining({
          credentials: 'include',
        })
      )
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('API_KEY')
    })

    it('should throw error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Not found' }),
      })

      await expect(secretsApi.getSecretsByRepo('owner', 'repo')).rejects.toThrow('Not found')
    })
  })

  describe('createSecretByRepo', () => {
    it('should create a secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          data: { id: '1', status: 'created' },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.createSecretByRepo('owner', 'repo', {
        name: 'NEW_KEY',
        value: 'secret-value',
        environment: 'production',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/secrets'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            key: 'NEW_KEY',
            value: 'secret-value',
            environment: 'production',
          }),
        })
      )
      expect(result.id).toBe('1')
      expect(result.name).toBe('NEW_KEY')
    })
  })

  describe('updateSecretByRepo', () => {
    it('should update a secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: '1',
            key: 'API_KEY',
            environment: 'production',
            createdAt: '2025-01-01',
            updatedAt: '2025-01-02',
            lastModifiedBy: null,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.updateSecretByRepo('owner', 'repo', 'secret-1', {
        value: 'new-value',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/secrets/secret-1'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
      expect(result.name).toBe('API_KEY')
    })
  })

  describe('deleteSecretByRepo', () => {
    it('should delete a secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: '1',
            key: 'API_KEY',
            environment: 'production',
            deletedAt: '2025-01-02',
            expiresAt: '2025-01-09',
            message: 'Deleted',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.deleteSecretByRepo('owner', 'repo', 'secret-1')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/secrets/secret-1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
      expect(result.key).toBe('API_KEY')
    })
  })

  describe('getSecretValue', () => {
    it('should fetch secret value', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { value: 'secret-value', preview: 'sec***' },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.getSecretValue('owner', 'repo', 'secret-1')

      expect(result.value).toBe('secret-value')
      expect(result.preview).toBe('sec***')
    })
  })

  describe('getSecretVersions', () => {
    it('should fetch secret versions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            versions: [
              { id: 'v1', versionNumber: 1, createdAt: '2025-01-01', createdBy: null },
              { id: 'v2', versionNumber: 2, createdAt: '2025-01-02', createdBy: { username: 'user', avatarUrl: null } },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.getSecretVersions('owner', 'repo', 'secret-1')

      expect(result).toHaveLength(2)
      expect(result[0].version_number).toBe(1)
      expect(result[1].created_by?.username).toBe('user')
    })
  })

  describe('getSecretVersionValue', () => {
    it('should fetch specific version value', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { value: 'old-value', versionNumber: 1 },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.getSecretVersionValue('owner', 'repo', 'secret-1', 'v1')

      expect(result.value).toBe('old-value')
      expect(result.versionNumber).toBe(1)
    })
  })

  describe('restoreSecretVersion', () => {
    it('should restore a version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { message: 'Restored', key: 'API_KEY', versionNumber: 1 },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await secretsApi.restoreSecretVersion('owner', 'repo', 'secret-1', 'v1')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/secrets/secret-1/versions/v1/restore'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(result.key).toBe('API_KEY')
      expect(result.versionNumber).toBe(1)
    })
  })
})
