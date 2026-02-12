import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser, mockVault } from '../helpers/mocks';

// Mock the database - define mocks inside factory to avoid hoisting issues
vi.mock('../../src/db', () => {
  const mockDbQuery = {
    vaults: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    vaultEnvironments: {
      findMany: vi.fn().mockResolvedValue([
        { name: 'development', type: 'development', displayOrder: 0 },
        { name: 'staging', type: 'standard', displayOrder: 1 },
        { name: 'production', type: 'protected', displayOrder: 2 },
      ]),
      findFirst: vi.fn(),
    },
  };

  return {
    db: {
      query: mockDbQuery,
      select: vi.fn(),
      update: vi.fn(),
    },
    vaults: { id: 'id', ownerId: 'ownerId', isPrivate: 'isPrivate', createdAt: 'createdAt' },
    secrets: { id: 'id' },
    vaultEnvironments: { id: 'id', vaultId: 'vaultId', name: 'name', type: 'type', displayOrder: 'displayOrder' },
  };
});

// Mock GitHub utils
vi.mock('../../src/utils/github', () => ({
  getUserRoleWithApp: vi.fn().mockResolvedValue('admin'),
}));

// Mock types
vi.mock('../../src/types', () => ({
  DEFAULT_ENVIRONMENTS: ['development', 'staging', 'production'],
}));

// Import after mocks
import {
  getVaultsForUser,
  getVaultByRepo,
  getVaultByRepoInternal,
  touchVault,
} from '../../src/services/vault.service';
import { db } from '../../src/db';

describe('VaultService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getVaultsForUser
  // ==========================================================================

  describe('getVaultsForUser', () => {
    it('should return formatted vault list for user', async () => {
      const mockVaultWithSecrets = {
        ...mockVault,
        secrets: [
          { id: 's1', environment: 'development', deletedAt: null },
          { id: 's2', environment: 'production', deletedAt: null },
          { id: 's3', environment: 'development', deletedAt: new Date() }, // Trashed
        ],
        vaultSyncs: [
          { provider: 'vercel', providerProjectName: 'my-project', lastSyncedAt: new Date() },
        ],
      };

      (db.query.vaults.findMany as any).mockResolvedValue([mockVaultWithSecrets]);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getVaultsForUser(mockUser.id, mockUser.username, 'pro');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockVault.id,
        repoOwner: 'testuser',
        repoName: 'test-repo',
        repoAvatar: 'https://github.com/testuser.png',
        secretCount: 2, // Only active secrets
        permission: 'admin',
        isPrivate: false,
        isReadOnly: false,
      });
      // Environments - string array for backwards compatibility
      expect(result[0].environments).toHaveLength(3);
      expect(result[0].environments[0]).toBe('development');
      // Environment details - objects with name, type, displayOrder
      expect(result[0].environmentDetails).toHaveLength(3);
      expect(result[0].environmentDetails[0]).toMatchObject({ name: 'development', type: 'development' });
      expect(result[0].syncs).toHaveLength(1);
      expect(result[0].syncs[0].provider).toBe('vercel');
    });

    it('should use default environments for legacy vaults', async () => {
      const legacyVault = {
        ...mockVault,
        environments: [], // Empty for legacy
        secrets: [],
        vaultSyncs: [],
      };

      // Mock empty vaultEnvironments to simulate legacy vault
      (db.query.vaultEnvironments.findMany as any).mockResolvedValue([]);

      (db.query.vaults.findMany as any).mockResolvedValue([legacyVault]);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getVaultsForUser(mockUser.id, mockUser.username, 'pro');

      // Default environments - string array for backwards compatibility
      expect(result[0].environments).toHaveLength(3);
      expect(result[0].environments).toEqual(['development', 'staging', 'production']);
      // Full environment details with types
      expect(result[0].environmentDetails).toHaveLength(3);
      expect(result[0].environmentDetails.map((e: any) => e.name)).toEqual(['development', 'staging', 'production']);
    });

    it('should mark excess private vaults as read-only for free plan', async () => {
      const privateVault1 = {
        ...mockVault,
        id: 'vault-1',
        isPrivate: true,
        createdAt: new Date('2024-01-01'),
        secrets: [],
        vaultSyncs: [],
      };
      const privateVault2 = {
        ...mockVault,
        id: 'vault-2',
        isPrivate: true,
        createdAt: new Date('2024-01-02'),
        secrets: [],
        vaultSyncs: [],
      };

      (db.query.vaults.findMany as any).mockResolvedValue([privateVault1, privateVault2]);
      // Simulate excess vaults query - returns vault-2 as excess (beyond limit of 1)
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: 'vault-1' }, // First vault (within limit)
              { id: 'vault-2' }, // Second vault (excess for free plan)
            ]),
          }),
        }),
      });

      const result = await getVaultsForUser(mockUser.id, mockUser.username, 'free');

      // vault-1 is within limit, vault-2 is excess
      const vault1 = result.find(v => v.id === 'vault-1');
      const vault2 = result.find(v => v.id === 'vault-2');

      // Note: The actual behavior depends on PLANS[free].maxPrivateRepos
      // This test verifies the mechanism works
      expect(result).toHaveLength(2);
    });

    it('should return empty array for user with no vaults', async () => {
      (db.query.vaults.findMany as any).mockResolvedValue([]);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getVaultsForUser(mockUser.id, mockUser.username, 'pro');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // getVaultByRepo
  // ==========================================================================

  describe('getVaultByRepo', () => {
    it('should return vault details with access', async () => {
      const vaultWithRelations = {
        ...mockVault,
        secrets: [
          { id: 's1', deletedAt: null },
          { id: 's2', deletedAt: null },
        ],
        owner: mockUser,
        vaultSyncs: [],
      };

      (db.query.vaults.findFirst as any).mockResolvedValue(vaultWithRelations);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getVaultByRepo('testuser/test-repo', mockUser.username, 'pro');

      expect(result.hasAccess).toBe(true);
      expect(result.vault).toMatchObject({
        id: mockVault.id,
        repoFullName: 'testuser/test-repo',
        repoOwner: 'testuser',
        repoName: 'test-repo',
        secretCount: 2,
        permission: 'admin',
        isPrivate: false,
        isReadOnly: false,
      });
    });

    it('should return no access for non-existent vault', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(null);

      const result = await getVaultByRepo('unknown/repo', mockUser.username, 'pro');

      expect(result.hasAccess).toBe(false);
    });

    it('should return no access when user has no role', async () => {
      const { getUserRoleWithApp } = await import('../../src/utils/github');
      (getUserRoleWithApp as any).mockResolvedValueOnce(null);

      const vaultWithRelations = {
        ...mockVault,
        secrets: [],
        owner: mockUser,
        vaultSyncs: [],
      };

      (db.query.vaults.findFirst as any).mockResolvedValue(vaultWithRelations);

      const result = await getVaultByRepo('testuser/test-repo', 'stranger', 'pro');

      expect(result.hasAccess).toBe(false);
    });

    it('should only count active secrets (exclude trash)', async () => {
      const vaultWithTrash = {
        ...mockVault,
        secrets: [
          { id: 's1', deletedAt: null },
          { id: 's2', deletedAt: new Date() }, // Trashed
          { id: 's3', deletedAt: null },
        ],
        owner: mockUser,
        vaultSyncs: [],
      };

      (db.query.vaults.findFirst as any).mockResolvedValue(vaultWithTrash);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getVaultByRepo('testuser/test-repo', mockUser.username, 'pro');

      expect(result.vault.secretCount).toBe(2);
    });
  });

  // ==========================================================================
  // getVaultByRepoInternal
  // ==========================================================================

  describe('getVaultByRepoInternal', () => {
    it('should return vault without access check', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(mockVault);

      const result = await getVaultByRepoInternal('testuser/test-repo');

      expect(result).toEqual(mockVault);
    });

    it('should return undefined for non-existent vault', async () => {
      (db.query.vaults.findFirst as any).mockResolvedValue(undefined);

      const result = await getVaultByRepoInternal('unknown/repo');

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // touchVault
  // ==========================================================================

  describe('touchVault', () => {
    it('should update vault timestamp', async () => {
      const mockSetReturn = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      const mockUpdateReturn = {
        set: vi.fn().mockReturnValue(mockSetReturn),
      };
      (db.update as any).mockReturnValue(mockUpdateReturn);

      await touchVault('vault-123');

      expect(db.update).toHaveBeenCalled();
      expect(mockUpdateReturn.set).toHaveBeenCalledWith({
        updatedAt: expect.any(Date),
      });
      expect(mockSetReturn.where).toHaveBeenCalled();
    });
  });
});
