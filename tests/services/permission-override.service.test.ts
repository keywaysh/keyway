import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser, mockVault } from '../helpers/mocks';

// Mock database
const mockDbQuery = {
  permissionOverrides: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateReturning = vi.fn();
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDbDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

vi.mock('../../src/db', () => ({
  db: {
    query: {
      permissionOverrides: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn(),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn(),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
  permissionOverrides: {
    id: 'id',
    vaultId: 'vaultId',
    environment: 'environment',
    targetType: 'targetType',
    targetUserId: 'targetUserId',
    targetRole: 'targetRole',
  },
  vaults: { id: 'id' },
  users: { id: 'id' },
}));

// Import after mocks
import {
  createOverride,
  updateOverride,
  deleteOverride,
  deleteOverridesForEnvironment,
  resetVaultOverrides,
  getOverrideById,
  getOverridesForVault,
  getOverridesForEnvironment,
  findApplicableOverride,
} from '../../src/services/permission-override.service';
import { db } from '../../src/db';

// Sample override data
const mockOverride = {
  id: 'override-123',
  vaultId: mockVault.id,
  environment: 'production',
  targetType: 'user' as const,
  targetUserId: mockUser.id,
  targetRole: null,
  canRead: true,
  canWrite: false,
  createdBy: mockUser.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRoleOverride = {
  id: 'override-456',
  vaultId: mockVault.id,
  environment: 'production',
  targetType: 'role' as const,
  targetUserId: null,
  targetRole: 'write' as const,
  canRead: true,
  canWrite: true,
  createdBy: mockUser.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PermissionOverrideService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // createOverride
  // ==========================================================================

  describe('createOverride', () => {
    it('should create user-targeted override', async () => {
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockOverride]),
        }),
      });

      const result = await createOverride({
        vaultId: mockVault.id,
        environment: 'production',
        targetType: 'user',
        targetUserId: mockUser.id,
        canRead: true,
        canWrite: false,
        createdBy: mockUser.id,
      });

      expect(result).toEqual(mockOverride);
      expect(db.insert).toHaveBeenCalled();
    });

    it('should create role-targeted override', async () => {
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockRoleOverride]),
        }),
      });

      const result = await createOverride({
        vaultId: mockVault.id,
        environment: 'production',
        targetType: 'role',
        targetRole: 'write',
        canRead: true,
        canWrite: true,
        createdBy: mockUser.id,
      });

      expect(result).toEqual(mockRoleOverride);
    });

    it('should throw error when targetUserId missing for user type', async () => {
      await expect(
        createOverride({
          vaultId: mockVault.id,
          environment: 'production',
          targetType: 'user',
          // Missing targetUserId
          canRead: true,
          canWrite: false,
          createdBy: mockUser.id,
        })
      ).rejects.toThrow('targetUserId is required when targetType is "user"');
    });

    it('should throw error when targetRole missing for role type', async () => {
      await expect(
        createOverride({
          vaultId: mockVault.id,
          environment: 'production',
          targetType: 'role',
          // Missing targetRole
          canRead: true,
          canWrite: false,
          createdBy: mockUser.id,
        })
      ).rejects.toThrow('targetRole is required when targetType is "role"');
    });

    it('should throw error on duplicate override', async () => {
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            new Error('permission_overrides_unique constraint violation')
          ),
        }),
      });

      await expect(
        createOverride({
          vaultId: mockVault.id,
          environment: 'production',
          targetType: 'user',
          targetUserId: mockUser.id,
          canRead: true,
          canWrite: false,
          createdBy: mockUser.id,
        })
      ).rejects.toThrow('A permission override already exists');
    });
  });

  // ==========================================================================
  // updateOverride
  // ==========================================================================

  describe('updateOverride', () => {
    it('should update override permissions', async () => {
      const updatedOverride = { ...mockOverride, canWrite: true };

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedOverride]),
          }),
        }),
      });

      const result = await updateOverride('override-123', { canWrite: true });

      expect(result.canWrite).toBe(true);
    });

    it('should update only canRead', async () => {
      const updatedOverride = { ...mockOverride, canRead: false };

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedOverride]),
          }),
        }),
      });

      const result = await updateOverride('override-123', { canRead: false });

      expect(result.canRead).toBe(false);
    });
  });

  // ==========================================================================
  // deleteOverride
  // ==========================================================================

  describe('deleteOverride', () => {
    it('should delete override by ID', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      await deleteOverride('override-123');

      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // deleteOverridesForEnvironment
  // ==========================================================================

  describe('deleteOverridesForEnvironment', () => {
    it('should delete all overrides for an environment', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      await deleteOverridesForEnvironment(mockVault.id, 'production');

      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // resetVaultOverrides
  // ==========================================================================

  describe('resetVaultOverrides', () => {
    it('should delete all overrides for a vault', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      await resetVaultOverrides(mockVault.id);

      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getOverrideById
  // ==========================================================================

  describe('getOverrideById', () => {
    it('should return formatted override with user target', async () => {
      (db.query.permissionOverrides.findFirst as any).mockResolvedValue({
        ...mockOverride,
        targetUser: {
          id: mockUser.id,
          username: mockUser.username,
          avatarUrl: mockUser.avatarUrl,
        },
        createdByUser: {
          id: mockUser.id,
          username: mockUser.username,
        },
      });

      const result = await getOverrideById('override-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('override-123');
      expect(result?.targetType).toBe('user');
      expect(result?.targetUser).toEqual({
        id: mockUser.id,
        username: mockUser.username,
        avatarUrl: mockUser.avatarUrl,
      });
      expect(result?.createdBy).toEqual({
        id: mockUser.id,
        username: mockUser.username,
      });
    });

    it('should return formatted override with role target', async () => {
      (db.query.permissionOverrides.findFirst as any).mockResolvedValue({
        ...mockRoleOverride,
        targetUser: null,
        createdByUser: {
          id: mockUser.id,
          username: mockUser.username,
        },
      });

      const result = await getOverrideById('override-456');

      expect(result).not.toBeNull();
      expect(result?.targetType).toBe('role');
      expect(result?.targetRole).toBe('write');
      expect(result?.targetUser).toBeUndefined();
    });

    it('should return null for non-existent override', async () => {
      (db.query.permissionOverrides.findFirst as any).mockResolvedValue(null);

      const result = await getOverrideById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getOverridesForVault
  // ==========================================================================

  describe('getOverridesForVault', () => {
    it('should return all overrides for a vault', async () => {
      (db.query.permissionOverrides.findMany as any).mockResolvedValue([
        { ...mockOverride, targetUser: null, createdByUser: null },
        { ...mockRoleOverride, targetUser: null, createdByUser: null },
      ]);

      const result = await getOverridesForVault(mockVault.id);

      expect(result).toHaveLength(2);
    });

    it('should return empty array for vault with no overrides', async () => {
      (db.query.permissionOverrides.findMany as any).mockResolvedValue([]);

      const result = await getOverridesForVault('vault-no-overrides');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // getOverridesForEnvironment
  // ==========================================================================

  describe('getOverridesForEnvironment', () => {
    it('should return overrides for specific environment', async () => {
      (db.query.permissionOverrides.findMany as any).mockResolvedValue([
        { ...mockOverride, targetUser: null, createdByUser: null },
      ]);

      const result = await getOverridesForEnvironment(mockVault.id, 'production');

      expect(result).toHaveLength(1);
      expect(result[0].environment).toBe('production');
    });

    it('should include wildcard environment overrides', async () => {
      const wildcardOverride = {
        ...mockOverride,
        id: 'wildcard-override',
        environment: '*',
        targetUser: null,
        createdByUser: null,
      };

      (db.query.permissionOverrides.findMany as any).mockResolvedValue([
        { ...mockOverride, targetUser: null, createdByUser: null },
        wildcardOverride,
      ]);

      const result = await getOverridesForEnvironment(mockVault.id, 'production');

      expect(result).toHaveLength(2);
      expect(result.some(o => o.environment === '*')).toBe(true);
    });
  });

  // ==========================================================================
  // findApplicableOverride
  // ==========================================================================

  describe('findApplicableOverride', () => {
    it('should prioritize user-specific exact environment override', async () => {
      const userOverride = { ...mockOverride };

      (db.query.permissionOverrides.findFirst as any).mockResolvedValue(userOverride);

      const result = await findApplicableOverride(
        mockVault.id,
        'production',
        mockUser.id,
        'write'
      );

      expect(result).toEqual(userOverride);
    });

    it('should fall back to user-specific wildcard override', async () => {
      const wildcardUserOverride = { ...mockOverride, environment: '*' };

      (db.query.permissionOverrides.findFirst as any)
        .mockResolvedValueOnce(null) // No exact user override
        .mockResolvedValueOnce(wildcardUserOverride); // Wildcard user override

      const result = await findApplicableOverride(
        mockVault.id,
        'production',
        mockUser.id,
        'write'
      );

      expect(result).toEqual(wildcardUserOverride);
    });

    it('should fall back to role-specific exact environment override', async () => {
      const roleOverride = { ...mockRoleOverride };

      (db.query.permissionOverrides.findFirst as any)
        .mockResolvedValueOnce(null) // No exact user override
        .mockResolvedValueOnce(null) // No wildcard user override
        .mockResolvedValueOnce(roleOverride); // Exact role override

      const result = await findApplicableOverride(
        mockVault.id,
        'production',
        mockUser.id,
        'write'
      );

      expect(result).toEqual(roleOverride);
    });

    it('should fall back to role-specific wildcard override', async () => {
      const wildcardRoleOverride = { ...mockRoleOverride, environment: '*' };

      (db.query.permissionOverrides.findFirst as any)
        .mockResolvedValueOnce(null) // No exact user override
        .mockResolvedValueOnce(null) // No wildcard user override
        .mockResolvedValueOnce(null) // No exact role override
        .mockResolvedValueOnce(wildcardRoleOverride); // Wildcard role override

      const result = await findApplicableOverride(
        mockVault.id,
        'production',
        mockUser.id,
        'write'
      );

      expect(result).toEqual(wildcardRoleOverride);
    });

    it('should return null when no applicable override found', async () => {
      (db.query.permissionOverrides.findFirst as any).mockResolvedValue(null);

      const result = await findApplicableOverride(
        mockVault.id,
        'production',
        mockUser.id,
        'write'
      );

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Edge Cases and Security
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle override with null createdBy', async () => {
      (db.query.permissionOverrides.findFirst as any).mockResolvedValue({
        ...mockOverride,
        createdBy: null,
        targetUser: null,
        createdByUser: null,
      });

      const result = await getOverrideById('override-123');

      expect(result?.createdBy).toBeNull();
    });

    it('should correctly format dates as ISO strings', async () => {
      const date = new Date('2024-01-15T10:00:00Z');

      (db.query.permissionOverrides.findFirst as any).mockResolvedValue({
        ...mockOverride,
        createdAt: date,
        updatedAt: date,
        targetUser: null,
        createdByUser: null,
      });

      const result = await getOverrideById('override-123');

      expect(result?.createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(result?.updatedAt).toBe('2024-01-15T10:00:00.000Z');
    });
  });
});
