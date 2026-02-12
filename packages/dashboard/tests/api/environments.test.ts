import { describe, it, expect, vi, beforeEach } from 'vitest'
import { environmentsApi } from '../../lib/api/environments'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('environmentsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getEnvironments', () => {
    it('should fetch all environments for a vault', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            environments: [
              { name: 'default', type: 'standard', displayOrder: 0 },
              { name: 'staging', type: 'standard', displayOrder: 1 },
              { name: 'production', type: 'protected', displayOrder: 2 },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await environmentsApi.getEnvironments('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/environments'),
        expect.any(Object)
      )
      expect(result).toEqual(['default', 'staging', 'production'])
    })
  })

  describe('createEnvironment', () => {
    it('should create a new environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          data: {
            environment: { name: 'testing', type: 'standard', displayOrder: 3 },
            environments: [
              { name: 'default', type: 'standard', displayOrder: 0 },
              { name: 'staging', type: 'standard', displayOrder: 1 },
              { name: 'production', type: 'protected', displayOrder: 2 },
              { name: 'testing', type: 'standard', displayOrder: 3 },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await environmentsApi.createEnvironment('owner', 'repo', 'testing')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/environments'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'testing' }),
        })
      )
      expect(result.environment).toBe('testing')
      expect(result.environments).toContain('testing')
    })
  })

  describe('renameEnvironment', () => {
    it('should rename an environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            oldName: 'testing',
            newName: 'test-renamed',
            environments: [
              { name: 'default', type: 'standard', displayOrder: 0 },
              { name: 'staging', type: 'standard', displayOrder: 1 },
              { name: 'production', type: 'protected', displayOrder: 2 },
              { name: 'test-renamed', type: 'standard', displayOrder: 3 },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await environmentsApi.renameEnvironment('owner', 'repo', 'testing', 'test-renamed')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/environments/testing'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
      expect(result.oldName).toBe('testing')
      expect(result.newName).toBe('test-renamed')
    })
  })

  describe('deleteEnvironment', () => {
    it('should delete an environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            deleted: 'testing',
            environments: [
              { name: 'default', type: 'standard', displayOrder: 0 },
              { name: 'staging', type: 'standard', displayOrder: 1 },
              { name: 'production', type: 'protected', displayOrder: 2 },
            ],
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await environmentsApi.deleteEnvironment('owner', 'repo', 'testing')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/vaults/owner/repo/environments/testing'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
      expect(result.deleted).toBe('testing')
    })
  })
})
