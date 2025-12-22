import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVault, mockSecret, mockUser } from '../helpers/mocks';

// Mock encryption service
const mockEncryptionService = {
  encrypt: vi.fn().mockResolvedValue({
    encryptedContent: 'encrypted-value',
    iv: 'mock-iv',
    authTag: 'mock-auth-tag',
    version: 1,
  }),
  decrypt: vi.fn().mockResolvedValue('decrypted-value'),
};

vi.mock('../../src/utils/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue({
      encryptedContent: 'encrypted-value',
      iv: 'mock-iv',
      authTag: 'mock-auth-tag',
      version: 1,
    }),
    decrypt: vi.fn().mockResolvedValue('decrypted-value'),
  }),
}));

// Mock secretVersion service
vi.mock('../../src/services/secretVersion.service', () => ({
  saveSecretVersion: vi.fn().mockResolvedValue(undefined),
}));

// Mock database
const mockDbQuery = {
  secrets: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockDeleteWhere = vi.fn();
const mockDbDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockSelectFrom = vi.fn();
const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock('../../src/db', () => ({
  db: {
    query: {
      secrets: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn(),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn(),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn(),
      }),
    }),
  },
  secrets: { id: 'id', vaultId: 'vaultId', key: 'key', environment: 'environment', deletedAt: 'deletedAt' },
}));

// Import after mocks
import {
  getSecretsForVault,
  upsertSecret,
  updateSecret,
  trashSecret,
  trashSecretsByIds,
  permanentlyDeleteSecret,
  getSecretById,
  getSecretsCount,
  secretExists,
  generatePreview,
  getSecretValue,
  getTrashedSecrets,
  getTrashedSecretsCount,
  getTrashedSecretById,
  restoreSecret,
  emptyTrash,
  purgeExpiredTrash,
} from '../../src/services/secret.service';
import { db } from '../../src/db';

describe('SecretService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getSecretsForVault
  // ==========================================================================

  describe('getSecretsForVault', () => {
    it('should return formatted secret list', async () => {
      const mockSecrets = [
        {
          ...mockSecret,
          lastModifiedBy: {
            username: 'testuser',
            avatarUrl: 'https://avatar.url',
          },
        },
      ];

      (db.query.secrets.findMany as any).mockResolvedValue(mockSecrets);

      const result = await getSecretsForVault('vault-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockSecret.id,
        key: mockSecret.key,
        environment: mockSecret.environment,
        lastModifiedBy: {
          username: 'testuser',
          avatarUrl: 'https://avatar.url',
        },
      });
    });

    it('should handle pagination options', async () => {
      (db.query.secrets.findMany as any).mockResolvedValue([]);

      await getSecretsForVault('vault-123', { limit: 10, offset: 5 });

      expect(db.query.secrets.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 5,
        })
      );
    });

    it('should handle secrets without lastModifiedBy', async () => {
      const mockSecrets = [
        {
          ...mockSecret,
          lastModifiedBy: null,
        },
      ];

      (db.query.secrets.findMany as any).mockResolvedValue(mockSecrets);

      const result = await getSecretsForVault('vault-123');

      expect(result[0].lastModifiedBy).toBeNull();
    });
  });

  // ==========================================================================
  // upsertSecret
  // ==========================================================================

  describe('upsertSecret', () => {
    it('should create new secret when not exists', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'new-secret-id' }]),
        }),
      });

      const result = await upsertSecret({
        vaultId: 'vault-123',
        key: 'API_KEY',
        value: 'secret-value',
        environment: 'development',
        userId: 'user-123',
      });

      expect(result).toEqual({ id: 'new-secret-id', status: 'created' });
    });

    it('should update existing secret', async () => {
      const existingSecret = {
        ...mockSecret,
        id: 'existing-secret-id',
        encryptedValue: 'old-encrypted',
        iv: 'old-iv',
        authTag: 'old-tag',
        encryptionVersion: 1,
      };

      (db.query.secrets.findFirst as any).mockResolvedValue(existingSecret);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const result = await upsertSecret({
        vaultId: 'vault-123',
        key: 'API_KEY',
        value: 'new-secret-value',
        environment: 'development',
        userId: 'user-123',
      });

      expect(result).toEqual({ id: 'existing-secret-id', status: 'updated' });
    });
  });

  // ==========================================================================
  // updateSecret
  // ==========================================================================

  describe('updateSecret', () => {
    it('should update secret by ID', async () => {
      const existingSecret = {
        ...mockSecret,
        encryptedValue: 'old-encrypted',
        iv: 'old-iv',
        authTag: 'old-tag',
        encryptionVersion: 1,
      };

      (db.query.secrets.findFirst as any)
        .mockResolvedValueOnce(existingSecret) // First call for existing check
        .mockResolvedValueOnce({ // Second call for return value
          ...existingSecret,
          key: 'UPDATED_KEY',
          lastModifiedBy: { username: 'testuser', avatarUrl: null },
        });

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const result = await updateSecret('secret-123', 'vault-123', { key: 'UPDATED_KEY' });

      expect(result).not.toBeNull();
      expect(result?.key).toBe('UPDATED_KEY');
    });

    it('should return null for non-existent secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await updateSecret('nonexistent', 'vault-123', { key: 'TEST' });

      expect(result).toBeNull();
    });

    it('should save version before updating value', async () => {
      const { saveSecretVersion } = await import('../../src/services/secretVersion.service');

      const existingSecret = {
        ...mockSecret,
        encryptedValue: 'old-encrypted',
        iv: 'old-iv',
        authTag: 'old-tag',
        encryptionVersion: 1,
      };

      (db.query.secrets.findFirst as any)
        .mockResolvedValueOnce(existingSecret)
        .mockResolvedValueOnce({ ...existingSecret, lastModifiedBy: null });

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      await updateSecret('secret-123', 'vault-123', { value: 'new-value', userId: 'user-123' });

      expect(saveSecretVersion).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // trashSecret
  // ==========================================================================

  describe('trashSecret', () => {
    it('should soft-delete secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(mockSecret);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const result = await trashSecret('secret-123', 'vault-123');

      expect(result).not.toBeNull();
      expect(result?.key).toBe(mockSecret.key);
      expect(result?.deletedAt).toBeInstanceOf(Date);
      expect(result?.expiresAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await trashSecret('nonexistent', 'vault-123');

      expect(result).toBeNull();
    });

    it('should calculate expiration 30 days from deletion', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(mockSecret);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const result = await trashSecret('secret-123', 'vault-123');

      const daysDiff = Math.round(
        (result!.expiresAt.getTime() - result!.deletedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(daysDiff).toBe(30);
    });
  });

  // ==========================================================================
  // trashSecretsByIds
  // ==========================================================================

  describe('trashSecretsByIds', () => {
    it('should do nothing for empty array', async () => {
      await trashSecretsByIds([]);

      expect(db.update).not.toHaveBeenCalled();
    });

    it('should bulk update deletedAt for multiple secrets', async () => {
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      await trashSecretsByIds(['id1', 'id2', 'id3']);

      expect(db.update).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // permanentlyDeleteSecret
  // ==========================================================================

  describe('permanentlyDeleteSecret', () => {
    it('should hard-delete trashed secret', async () => {
      const trashedSecret = {
        ...mockSecret,
        deletedAt: new Date(),
      };

      (db.query.secrets.findFirst as any).mockResolvedValue(trashedSecret);
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const result = await permanentlyDeleteSecret('secret-123', 'vault-123');

      expect(result).toEqual({
        key: mockSecret.key,
        environment: mockSecret.environment,
      });
      expect(db.delete).toHaveBeenCalled();
    });

    it('should return null for non-trashed secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await permanentlyDeleteSecret('active-secret', 'vault-123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getSecretById
  // ==========================================================================

  describe('getSecretById', () => {
    it('should return secret by ID', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue({
        ...mockSecret,
        lastModifiedBy: { username: 'testuser', avatarUrl: null },
      });

      const result = await getSecretById('secret-123', 'vault-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe(mockSecret.id);
    });

    it('should return null for non-existent secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await getSecretById('nonexistent', 'vault-123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getSecretsCount
  // ==========================================================================

  describe('getSecretsCount', () => {
    it('should return count of active secrets', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 42 }]),
        }),
      });

      const result = await getSecretsCount('vault-123');

      expect(result).toBe(42);
    });

    it('should return 0 for empty vault', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });

      const result = await getSecretsCount('empty-vault');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // secretExists
  // ==========================================================================

  describe('secretExists', () => {
    it('should return true when secret exists', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(mockSecret);

      const result = await secretExists('vault-123', 'API_KEY', 'development');

      expect(result).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await secretExists('vault-123', 'NONEXISTENT', 'development');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // generatePreview (pure function)
  // ==========================================================================

  describe('generatePreview', () => {
    it('should mask short values completely', () => {
      expect(generatePreview('short')).toBe('••••••••');
      expect(generatePreview('')).toBe('••••••••');
    });

    it('should show first 2 and last 2 for medium values', () => {
      expect(generatePreview('123456789')).toBe('12••••89');
    });

    it('should show first 4 and last 4 for long values', () => {
      expect(generatePreview('this_is_a_very_long_secret_value')).toMatch(/^.{4}••••.{4}$/);
    });
  });

  // ==========================================================================
  // getSecretValue
  // ==========================================================================

  describe('getSecretValue', () => {
    it('should return decrypted value and preview', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue({
        ...mockSecret,
        encryptedValue: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
        encryptionVersion: 1,
      });

      const result = await getSecretValue('secret-123', 'vault-123');

      expect(result).not.toBeNull();
      expect(result?.value).toBe('decrypted-value');
      expect(result?.preview).toMatch(/••••/);
    });

    it('should return null for non-existent secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await getSecretValue('nonexistent', 'vault-123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Trash Operations
  // ==========================================================================

  describe('getTrashedSecrets', () => {
    it('should return formatted trashed secrets', async () => {
      const deletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      (db.query.secrets.findMany as any).mockResolvedValue([
        {
          ...mockSecret,
          deletedAt,
        },
      ]);

      const result = await getTrashedSecrets('vault-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockSecret.id,
        key: mockSecret.key,
        environment: mockSecret.environment,
      });
      expect(result[0].daysRemaining).toBe(25); // 30 - 5 = 25
    });
  });

  describe('getTrashedSecretsCount', () => {
    it('should return count of trashed secrets', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 5 }]),
        }),
      });

      const result = await getTrashedSecretsCount('vault-123');

      expect(result).toBe(5);
    });
  });

  describe('getTrashedSecretById', () => {
    it('should return trashed secret info', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue({
        ...mockSecret,
        deletedAt: new Date(),
      });

      const result = await getTrashedSecretById('secret-123', 'vault-123');

      expect(result).toEqual({
        id: mockSecret.id,
        key: mockSecret.key,
        environment: mockSecret.environment,
      });
    });

    it('should return null for active secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await getTrashedSecretById('active-secret', 'vault-123');

      expect(result).toBeNull();
    });
  });

  describe('restoreSecret', () => {
    it('should restore trashed secret', async () => {
      const trashedSecret = {
        ...mockSecret,
        deletedAt: new Date(),
      };

      (db.query.secrets.findFirst as any)
        .mockResolvedValueOnce(trashedSecret) // First call: get trashed
        .mockResolvedValueOnce(null); // Second call: check conflict

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const result = await restoreSecret('secret-123', 'vault-123');

      expect(result).toEqual({
        id: mockSecret.id,
        key: mockSecret.key,
        environment: mockSecret.environment,
      });
    });

    it('should throw error on conflict with active secret', async () => {
      const trashedSecret = {
        ...mockSecret,
        deletedAt: new Date(),
      };

      const activeSecret = {
        ...mockSecret,
        id: 'active-secret-id',
        deletedAt: null,
      };

      (db.query.secrets.findFirst as any)
        .mockResolvedValueOnce(trashedSecret) // Get trashed
        .mockResolvedValueOnce(activeSecret); // Conflict found

      await expect(restoreSecret('secret-123', 'vault-123')).rejects.toThrow(
        /already exists/
      );
    });

    it('should return null for non-trashed secret', async () => {
      (db.query.secrets.findFirst as any).mockResolvedValue(null);

      const result = await restoreSecret('active-secret', 'vault-123');

      expect(result).toBeNull();
    });
  });

  describe('emptyTrash', () => {
    it('should delete all trashed secrets and return count', async () => {
      const trashedSecrets = [
        { ...mockSecret, id: 's1', key: 'KEY1', deletedAt: new Date() },
        { ...mockSecret, id: 's2', key: 'KEY2', deletedAt: new Date() },
      ];

      (db.query.secrets.findMany as any).mockResolvedValue(trashedSecrets);
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const result = await emptyTrash('vault-123');

      expect(result.deleted).toBe(2);
      expect(result.keys).toEqual(['KEY1', 'KEY2']);
    });

    it('should return zero for empty trash', async () => {
      (db.query.secrets.findMany as any).mockResolvedValue([]);

      const result = await emptyTrash('vault-123');

      expect(result).toEqual({ deleted: 0, keys: [] });
    });
  });

  describe('purgeExpiredTrash', () => {
    it('should delete expired trash and return count', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
        }),
      });

      const result = await purgeExpiredTrash();

      expect(result.purged).toBe(2);
    });

    it('should return zero when no expired trash', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await purgeExpiredTrash();

      expect(result.purged).toBe(0);
    });
  });
});
