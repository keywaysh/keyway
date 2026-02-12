import { describe, it, expect, vi, beforeEach } from 'vitest'
import { securityApi } from '../../lib/api/security'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('securityApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMySecurityAlerts', () => {
    it('should fetch user security alerts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: 'alert-1',
              type: 'secret_exposed',
              severity: 'high',
              created_at: '2025-01-01T00:00:00Z',
            },
          ],
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await securityApi.getMySecurityAlerts()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me/security/alerts'),
        expect.any(Object)
      )
      expect(result).toHaveLength(1)
      expect(result[0].severity).toBe('high')
    })

    it('should support pagination options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [],
          meta: { requestId: 'req-1' },
        }),
      })

      await securityApi.getMySecurityAlerts({ limit: 10, offset: 5 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      )
    })
  })

  describe('getSecurityOverview', () => {
    it('should fetch security overview', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            total_vaults: 5,
            total_secrets: 25,
            alerts_count: 2,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await securityApi.getSecurityOverview()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me/security/overview'),
        expect.any(Object)
      )
      expect(result.total_vaults).toBe(5)
    })
  })

  describe('getAccessLog', () => {
    it('should fetch access log', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            logs: [
              {
                id: 'log-1',
                action: 'secret_read',
                user: 'testuser',
                timestamp: '2025-01-01T00:00:00Z',
              },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await securityApi.getAccessLog()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/me/security/access-log'),
        expect.any(Object)
      )
      expect(result.logs).toHaveLength(1)
      expect(result.logs[0].action).toBe('secret_read')
    })

    it('should support filter options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { logs: [] },
          meta: { requestId: 'req-1' },
        }),
      })

      await securityApi.getAccessLog({ limit: 50, vaultId: 'vault-123' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('vaultId=vault-123'),
        expect.any(Object)
      )
    })
  })
})
