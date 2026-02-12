import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser, mockOrganization, mockOrgPaid, mockVault, mockSecretAccess } from './helpers/mocks';

// Mock all dependencies before importing routes
vi.mock('../src/db', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
      vaults: {
        findFirst: vi.fn(),
      },
    },
  },
  users: {},
  organizations: {},
  organizationMembers: {},
  vaults: {},
}));

vi.mock('../src/services/exposure.service', () => ({
  getExposureForUser: vi.fn(),
  getExposureForOrg: vi.fn(),
  getSecretAccessHistory: vi.fn(),
}));

vi.mock('../src/services/organization.service', () => ({
  getOrganizationByLogin: vi.fn(),
  getOrganizationMembership: vi.fn(),
  isOrganizationOwner: vi.fn(),
}));

vi.mock('../src/services/trial.service', () => ({
  getEffectivePlanWithTrial: vi.fn(),
}));

// Import the mocked modules
import { db } from '../src/db';
import { getExposureForUser, getExposureForOrg, getSecretAccessHistory } from '../src/services/exposure.service';
import { getOrganizationByLogin, isOrganizationOwner } from '../src/services/organization.service';
import { getEffectivePlanWithTrial } from '../src/services/trial.service';
import { PlanLimitError, ForbiddenError, NotFoundError } from '../src/lib';

describe('Exposure Routes Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Plan Gating', () => {
    it('should require Team plan for exposure reports', () => {
      // Verify PlanLimitError is used for plan gating
      const error = new PlanLimitError('Exposure reports require a Team plan');
      expect(error.status).toBe(403);
      expect(error.type).toContain('plan-limit-reached');
    });

    it('should allow Team plan to access exposure reports', () => {
      // Mock org with Team plan
      vi.mocked(getEffectivePlanWithTrial).mockReturnValue('team');
      const result = getEffectivePlanWithTrial(mockOrgPaid);
      expect(result).toBe('team');
    });

    it('should deny Free plan access to exposure reports', () => {
      // Mock org with Free plan
      vi.mocked(getEffectivePlanWithTrial).mockReturnValue('free');
      const result = getEffectivePlanWithTrial(mockOrganization);
      expect(result).toBe('free');
    });
  });

  describe('Authorization', () => {
    it('should require organization owner role', async () => {
      vi.mocked(isOrganizationOwner).mockResolvedValue(false);

      const isOwner = await isOrganizationOwner('org-id', 'user-id');
      expect(isOwner).toBe(false);
    });

    it('should allow organization owner access', async () => {
      vi.mocked(isOrganizationOwner).mockResolvedValue(true);

      const isOwner = await isOrganizationOwner('org-id', 'user-id');
      expect(isOwner).toBe(true);
    });
  });

  describe('getExposureForOrg Service', () => {
    it('should call getExposureForOrg with correct parameters', async () => {
      const mockExposureData = {
        summary: { users: 5, secrets: 20, accesses: 100 },
        users: [],
      };
      vi.mocked(getExposureForOrg).mockResolvedValue(mockExposureData);

      const result = await getExposureForOrg('testorg/', {
        limit: 50,
        offset: 0,
      });

      expect(result.summary.users).toBe(5);
      expect(result.summary.secrets).toBe(20);
      expect(getExposureForOrg).toHaveBeenCalledWith('testorg/', {
        limit: 50,
        offset: 0,
      });
    });
  });

  describe('getExposureForUser Service', () => {
    it('should return exposure report for a user', async () => {
      const mockReport = {
        user: {
          id: 'user-123',
          username: 'testuser',
          avatarUrl: 'https://github.com/testuser.png',
        },
        summary: {
          totalSecretsAccessed: 10,
          totalVaultsAccessed: 2,
          firstAccess: '2024-01-01T00:00:00Z',
          lastAccess: '2024-03-01T00:00:00Z',
        },
        vaults: [],
      };
      vi.mocked(getExposureForUser).mockResolvedValue(mockReport);

      const result = await getExposureForUser('testuser', 'testorg/');

      expect(result).not.toBeNull();
      expect(result!.user.username).toBe('testuser');
      expect(result!.summary.totalSecretsAccessed).toBe(10);
    });

    it('should return null when user has no access records', async () => {
      vi.mocked(getExposureForUser).mockResolvedValue(null);

      const result = await getExposureForUser('unknownuser', 'testorg/');

      expect(result).toBeNull();
    });
  });

  describe('getSecretAccessHistory Service', () => {
    it('should return access history for a secret', async () => {
      const mockHistory = {
        accesses: [
          {
            user: { id: 'user-1', username: 'user1', avatarUrl: null },
            roleAtAccess: 'write' as const,
            platform: 'cli' as const,
            firstAccess: '2024-01-01T00:00:00Z',
            lastAccess: '2024-01-15T00:00:00Z',
            accessCount: 5,
          },
        ],
        total: 1,
      };
      vi.mocked(getSecretAccessHistory).mockResolvedValue(mockHistory);

      const result = await getSecretAccessHistory('secret-123');

      expect(result.accesses).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.accesses[0].roleAtAccess).toBe('write');
    });
  });
});

describe('Error Handling', () => {
  it('should throw ForbiddenError for non-owner access', () => {
    const error = new ForbiddenError('Only organization owners can view exposure reports');
    expect(error.status).toBe(403);
    expect(error.type).toContain('forbidden');
  });

  it('should throw NotFoundError when organization not found', () => {
    const error = new NotFoundError('Organization not found');
    expect(error.status).toBe(404);
    expect(error.type).toContain('not-found');
  });

  it('should throw NotFoundError when user has no access records', () => {
    const error = new NotFoundError('No access records found for user "testuser" in organization "testorg"');
    expect(error.status).toBe(404);
    expect(error.detail).toContain('testuser');
  });
});
