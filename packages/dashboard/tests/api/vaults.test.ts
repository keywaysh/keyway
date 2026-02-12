import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vaultsApi } from '../../lib/api/vaults'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('vaultsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getVaults', () => {
    it('should fetch all vaults', async () => {
      const mockVaultsResponse = {
        data: [
          {
            id: '1',
            repoOwner: 'owner1',
            repoName: 'repo1',
            repoAvatar: 'https://avatar1.png',
            secretCount: 5,
            environments: ['default', 'production'],
            permission: 'admin',
            isPrivate: false,
            isReadOnly: false,
            syncs: [],
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
        meta: { requestId: 'req-1', pagination: { total: 1, limit: 50, offset: 0, hasMore: false } },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockVaultsResponse),
      })

      const result = await vaultsApi.getVaults()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults'),
        expect.objectContaining({
          credentials: 'include',
        })
      )
      expect(result).toHaveLength(1)
      expect(result[0].repo_owner).toBe('owner1')
      expect(result[0].secrets_count).toBe(5)
    })
  })

  describe('getVaultByRepo', () => {
    it('should fetch vault by repo', async () => {
      const mockVault = {
        data: {
          id: '1',
          repoFullName: 'owner/repo',
          repoOwner: 'owner',
          repoName: 'repo',
          repoAvatar: 'https://avatar.png',
          secretCount: 10,
          environments: ['default', 'staging', 'production'],
          permission: 'write',
          isPrivate: true,
          isReadOnly: false,
          syncs: [
            {
              id: 's1',
              provider: 'vercel',
              projectId: 'proj-1',
              projectName: 'My Project',
              connectionId: 'conn-1',
              keywayEnvironment: 'production',
              providerEnvironment: 'production',
              lastSyncedAt: '2025-01-01T00:00:00Z',
            },
          ],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        meta: { requestId: 'req-1' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockVault),
      })

      const result = await vaultsApi.getVaultByRepo('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo'),
        expect.any(Object)
      )
      expect(result.repo_name).toBe('repo')
      expect(result.secrets_count).toBe(10)
      expect(result.syncs).toHaveLength(1)
      expect(result.syncs[0].provider).toBe('vercel')
    })

    it('should throw on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Vault not found' }),
      })

      await expect(vaultsApi.getVaultByRepo('owner', 'missing')).rejects.toThrow('Vault not found')
    })
  })

  describe('deleteVault', () => {
    it('should delete a vault', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      await vaultsApi.deleteVault('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })
})
