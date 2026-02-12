import { describe, it, expect, vi, beforeEach } from 'vitest'
import { organizationsApi } from '../../lib/api/organizations'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('organizationsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getOrganizations', () => {
    it('should fetch all organizations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: '1',
              login: 'acme',
              displayName: 'ACME Corp',
              avatarUrl: 'https://avatar.png',
              plan: 'team',
              role: 'owner',
              memberCount: 10,
              vaultCount: 5,
              createdAt: '2025-01-01T00:00:00Z',
            },
          ],
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.getOrganizations()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs'),
        expect.objectContaining({
          credentials: 'include',
        })
      )
      expect(result).toHaveLength(1)
      expect(result[0].login).toBe('acme')
      expect(result[0].display_name).toBe('ACME Corp')
      expect(result[0].member_count).toBe(10)
    })
  })

  describe('getOrganization', () => {
    it('should fetch organization by login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: '1',
            login: 'acme',
            displayName: 'ACME Corp',
            avatarUrl: 'https://avatar.png',
            plan: 'team',
            role: 'owner',
            memberCount: 10,
            vaultCount: 5,
            stripeCustomerId: 'cus_123',
            trial: {
              status: 'none',
              startedAt: null,
              endsAt: null,
              convertedAt: null,
              daysRemaining: null,
            },
            effectivePlan: 'team',
            defaultPermissions: {},
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            trialDurationDays: 15,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.getOrganization('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme'),
        expect.any(Object)
      )
      expect(result.login).toBe('acme')
      expect(result.effective_plan).toBe('team')
    })
  })

  describe('getOrganizationMembers', () => {
    it('should fetch organization members', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            { id: '1', username: 'john', avatarUrl: 'https://john.png', role: 'owner', joinedAt: '2025-01-01' },
            { id: '2', username: 'jane', avatarUrl: 'https://jane.png', role: 'member', joinedAt: '2025-01-02' },
          ],
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.getOrganizationMembers('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/members'),
        expect.any(Object)
      )
      expect(result).toHaveLength(2)
      expect(result[0].username).toBe('john')
      expect(result[1].role).toBe('member')
    })
  })

  describe('syncOrganizationMembers', () => {
    it('should sync organization members', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { message: 'Synced', added: 2, updated: 1, removed: 0 },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.syncOrganizationMembers('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/members/sync'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(result.added).toBe(2)
      expect(result.updated).toBe(1)
    })
  })

  describe('updateOrganization', () => {
    it('should update organization settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            id: '1',
            login: 'acme',
            displayName: 'ACME Updated',
            defaultPermissions: { read: true },
            updatedAt: '2025-01-02T00:00:00Z',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.updateOrganization('acme', { displayName: 'ACME Updated' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme'),
        expect.objectContaining({
          method: 'PUT',
        })
      )
      expect(result.display_name).toBe('ACME Updated')
    })
  })

  describe('getAvailableOrganizations', () => {
    it('should fetch available organizations from GitHub', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            organizations: [
              {
                login: 'new-org',
                display_name: 'New Organization',
                avatar_url: 'https://new.png',
                status: 'ready',
                user_role: 'admin',
                already_connected: false,
              },
            ],
            install_url: 'https://github.com/apps/keyway/installations/new',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.getAvailableOrganizations()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/github/available-orgs'),
        expect.any(Object)
      )
      expect(result.organizations).toHaveLength(1)
      expect(result.organizations[0].login).toBe('new-org')
    })
  })

  describe('connectOrganization', () => {
    it('should connect an organization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          data: {
            organization: {
              id: '1',
              login: 'new-org',
              displayName: 'New Organization',
              avatarUrl: 'https://new.png',
              plan: 'free',
              role: 'owner',
              memberCount: 1,
              vaultCount: 0,
              stripeCustomerId: null,
              trial: {
                status: 'none',
                startedAt: null,
                endsAt: null,
                convertedAt: null,
                daysRemaining: null,
              },
              effectivePlan: 'free',
              defaultPermissions: {},
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
              trialDurationDays: 15,
            },
            message: 'Organization connected successfully',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await organizationsApi.connectOrganization('new-org')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/connect'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ orgLogin: 'new-org' }),
        })
      )
      expect(result.organization.login).toBe('new-org')
      expect(result.message).toBe('Organization connected successfully')
    })
  })
})
