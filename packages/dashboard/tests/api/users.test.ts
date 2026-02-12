import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usersApi } from '../../lib/api/users'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('usersApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMe', () => {
    it('should fetch current user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: 'user-1',
            githubId: 12345,
            username: 'testuser',
            email: 'test@example.com',
            avatarUrl: 'https://avatar.png',
            createdAt: '2025-01-01T00:00:00Z',
            plan: 'pro',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await usersApi.getMe()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me'),
        expect.objectContaining({
          credentials: 'include',
        })
      )
      expect(result.name).toBe('testuser')
      expect(result.email).toBe('test@example.com')
      expect(result.github_username).toBe('testuser')
      expect(result.plan).toBe('pro')
    })

    it('should handle missing optional fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: null,
            githubId: 12345,
            username: 'testuser',
            email: null,
            avatarUrl: null,
            createdAt: null,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await usersApi.getMe()

      expect(result.id).toBe('12345')
      expect(result.email).toBe('')
      expect(result.avatar_url).toBe('')
      expect(result.plan).toBe('free')
    })
  })

  describe('getUsage', () => {
    it('should fetch user usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            plan: 'pro',
            limits: {
              maxPublicRepos: 'unlimited',
              maxPrivateRepos: 50,
              maxProviders: 5,
              maxEnvironmentsPerVault: 10,
              maxSecretsPerPrivateVault: 100,
            },
            usage: {
              public: 3,
              private: 5,
              providers: 2,
            },
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await usersApi.getUsage()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me/usage'),
        expect.any(Object)
      )
      expect(result.plan).toBe('pro')
      expect(result.usage.public).toBe(3)
      expect(result.limits.maxPrivateRepos).toBe(50)
    })
  })
})
