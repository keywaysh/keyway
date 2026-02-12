import { describe, it, expect, vi, beforeEach } from 'vitest'
import { collaboratorsApi } from '../../lib/api/collaborators'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('collaboratorsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getVaultCollaborators', () => {
    it('should fetch vault collaborators', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            repoId: 'repo-123',
            provider: 'github',
            contributors: [
              {
                id: 'contrib-1',
                login: 'testuser',
                avatar_url: 'https://avatar.png',
                type: 'User',
                contributions: 50,
              },
              {
                id: 'contrib-2',
                login: 'anotheruser',
                avatar_url: 'https://avatar2.png',
                type: 'User',
                contributions: 25,
              },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await collaboratorsApi.getVaultCollaborators('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/contributors'),
        expect.any(Object)
      )
      expect(result).toHaveLength(2)
      expect(result[0].login).toBe('testuser')
      expect(result[0].contributions).toBe(50)
    })

    it('should return empty array when no collaborators', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            repoId: 'repo-123',
            provider: 'github',
            contributors: [],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await collaboratorsApi.getVaultCollaborators('owner', 'repo')

      expect(result).toEqual([])
    })
  })
})
