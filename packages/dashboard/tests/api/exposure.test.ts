import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exposureApi } from '../../lib/api/exposure'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('exposureApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMyExposure', () => {
    it('should fetch user exposure summary', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            total_users: 5,
            users: [
              { username: 'user1', exposure_count: 10 },
              { username: 'user2', exposure_count: 5 },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await exposureApi.getMyExposure()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me/exposure'),
        expect.any(Object)
      )
      expect(result.total_users).toBe(5)
    })

    it('should support date range options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { total_users: 0, users: [] },
          meta: { requestId: 'req-1' },
        }),
      })

      await exposureApi.getMyExposure({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('startDate=2025-01-01'),
        expect.any(Object)
      )
    })
  })

  describe('getMyExposureUser', () => {
    it('should fetch exposure for a specific user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            username: 'testuser',
            vaults: [
              { vault_id: 'v1', vault_name: 'owner/repo', secrets_accessed: 5 },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await exposureApi.getMyExposureUser('testuser')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me/exposure/testuser'),
        expect.any(Object)
      )
      expect(result.username).toBe('testuser')
    })
  })

  describe('getOrganizationExposure', () => {
    it('should fetch organization exposure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            total_users: 10,
            users: [],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await exposureApi.getOrganizationExposure('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/exposure'),
        expect.any(Object)
      )
      expect(result.total_users).toBe(10)
    })

    it('should support vault filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { total_users: 0, users: [] },
          meta: { requestId: 'req-1' },
        }),
      })

      await exposureApi.getOrganizationExposure('acme', { vaultId: 'vault-123' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('vaultId=vault-123'),
        expect.any(Object)
      )
    })
  })

  describe('getUserExposure', () => {
    it('should fetch user exposure in organization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            username: 'member1',
            vaults: [],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await exposureApi.getUserExposure('acme', 'member1')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/exposure/member1'),
        expect.any(Object)
      )
      expect(result.username).toBe('member1')
    })
  })
})
