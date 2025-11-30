import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock data
const mockUser = {
  id: 'user-123',
  githubId: 12345,
};

const mockConnection = {
  id: 'conn-123',
  userId: mockUser.id,
  provider: 'vercel',
  providerUserId: 'vercel-user-123',
  providerTeamId: 'team-123',
  encryptedAccessToken: 'encrypted',
  accessTokenIv: '0'.repeat(32),
  accessTokenAuthTag: '0'.repeat(32),
  encryptedRefreshToken: null,
  refreshTokenIv: null,
  refreshTokenAuthTag: null,
  tokenExpiresAt: null,
  scopes: ['user:read'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockVault = {
  id: 'vault-123',
  repoFullName: 'testuser/test-repo',
};

const mockSecrets = [
  {
    id: 'secret-1',
    vaultId: mockVault.id,
    environment: 'production',
    key: 'API_KEY',
    encryptedValue: 'encrypted',
    iv: '0'.repeat(32),
    authTag: '0'.repeat(32),
  },
  {
    id: 'secret-2',
    vaultId: mockVault.id,
    environment: 'production',
    key: 'DATABASE_URL',
    encryptedValue: 'encrypted',
    iv: '0'.repeat(32),
    authTag: '0'.repeat(32),
  },
];

// Mock encryption service
vi.mock('../src/utils/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue({
      encryptedContent: 'encrypted',
      iv: '0'.repeat(32),
      authTag: '0'.repeat(32),
    }),
    decrypt: vi.fn().mockImplementation(({ encryptedContent }) => {
      // Return different values based on what's being decrypted
      if (encryptedContent === 'encrypted') return Promise.resolve('decrypted-value');
      return Promise.resolve('token-value');
    }),
  }),
}));

// Mock database
vi.mock('../src/db', () => {
  const mockDb = {
    query: {
      providerConnections: {
        findFirst: vi.fn().mockResolvedValue(mockConnection),
        findMany: vi.fn().mockResolvedValue([mockConnection]),
      },
      vaultSyncs: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      secrets: {
        findMany: vi.fn().mockResolvedValue(mockSecrets),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([mockConnection]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'deleted' }]),
    }),
    transaction: vi.fn().mockImplementation(async (cb) => cb({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
    })),
  };

  return {
    db: mockDb,
    providerConnections: { id: 'id', userId: 'userId', provider: 'provider' },
    vaultSyncs: { id: 'id', vaultId: 'vaultId' },
    syncLogs: { id: 'id' },
    secrets: { id: 'id', vaultId: 'vaultId', environment: 'environment' },
    vaults: { id: 'id' },
  };
});

// Mock providers
const mockProvider = {
  name: 'vercel',
  displayName: 'Vercel',
  listProjects: vi.fn().mockResolvedValue([
    { id: 'prj_123', name: 'my-project' },
  ]),
  getProject: vi.fn().mockResolvedValue({ id: 'prj_123', name: 'my-project' }),
  listEnvVars: vi.fn().mockResolvedValue([
    { key: 'API_KEY', value: 'provider-value', target: ['production'] },
    { key: 'NEW_VAR', value: 'new-value', target: ['production'] },
  ]),
  setEnvVars: vi.fn().mockResolvedValue({ created: 1, updated: 1, failed: 0, failedKeys: [] }),
  deleteEnvVar: vi.fn().mockResolvedValue(undefined),
  deleteEnvVars: vi.fn().mockResolvedValue({ deleted: 1, failed: 0, failedKeys: [] }),
};

vi.mock('../src/services/providers', () => ({
  getProvider: vi.fn().mockReturnValue(mockProvider),
}));

describe('Integration Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listConnections', () => {
    it('should return user connections', async () => {
      const { listConnections } = await import('../src/services/integration.service');

      const connections = await listConnections(mockUser.id);

      expect(connections).toHaveLength(1);
      expect(connections[0]).toHaveProperty('id', mockConnection.id);
      expect(connections[0]).toHaveProperty('provider', 'vercel');
    });
  });

  describe('getConnection', () => {
    it('should return connection by provider', async () => {
      const { getConnection } = await import('../src/services/integration.service');

      const connection = await getConnection(mockUser.id, 'vercel');

      expect(connection).not.toBeNull();
      expect(connection?.provider).toBe('vercel');
    });

    it('should return null for non-existent connection', async () => {
      const { db } = await import('../src/db');
      (db.query.providerConnections.findFirst as any).mockResolvedValueOnce(null);

      const { getConnection } = await import('../src/services/integration.service');

      const connection = await getConnection(mockUser.id, 'nonexistent');

      expect(connection).toBeNull();
    });
  });

  describe('deleteConnection', () => {
    it('should delete connection and return true', async () => {
      const { deleteConnection } = await import('../src/services/integration.service');

      const result = await deleteConnection(mockUser.id, mockConnection.id);

      expect(result).toBe(true);
    });

    it('should return false if connection not found', async () => {
      const { db } = await import('../src/db');
      (db.delete as any).mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      });

      const { deleteConnection } = await import('../src/services/integration.service');

      const result = await deleteConnection(mockUser.id, 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('listProviderProjects', () => {
    it('should list projects from provider', async () => {
      const { listProviderProjects } = await import('../src/services/integration.service');

      const projects = await listProviderProjects(mockConnection.id, mockUser.id);

      expect(projects).toHaveLength(1);
      expect(mockProvider.listProjects).toHaveBeenCalled();
    });

    it('should throw if connection not found', async () => {
      const { db } = await import('../src/db');
      (db.query.providerConnections.findFirst as any).mockResolvedValueOnce(null);

      const { listProviderProjects } = await import('../src/services/integration.service');

      await expect(listProviderProjects('nonexistent', mockUser.id))
        .rejects.toThrow('Connection not found');
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status info', async () => {
      const { getSyncStatus } = await import('../src/services/integration.service');

      const status = await getSyncStatus(
        mockVault.id,
        mockConnection.id,
        'prj_123',
        'production',
        mockUser.id
      );

      expect(status).toHaveProperty('isFirstSync');
      expect(status).toHaveProperty('vaultIsEmpty');
      expect(status).toHaveProperty('providerHasSecrets');
      expect(status).toHaveProperty('providerSecretCount');
    });

    it('should detect first sync', async () => {
      const { getSyncStatus } = await import('../src/services/integration.service');

      const status = await getSyncStatus(
        mockVault.id,
        mockConnection.id,
        'prj_123',
        'production',
        mockUser.id
      );

      expect(status.isFirstSync).toBe(true);
    });
  });

  describe('getSyncPreview', () => {
    it('should return preview of changes for push', async () => {
      const { getSyncPreview } = await import('../src/services/integration.service');

      const preview = await getSyncPreview(
        mockVault.id,
        mockConnection.id,
        'prj_123',
        'production',
        'production',
        'push',
        false,
        mockUser.id
      );

      expect(preview).toHaveProperty('toCreate');
      expect(preview).toHaveProperty('toUpdate');
      expect(preview).toHaveProperty('toDelete');
      expect(preview).toHaveProperty('toSkip');
    });

    it('should return preview of changes for pull', async () => {
      const { getSyncPreview } = await import('../src/services/integration.service');

      const preview = await getSyncPreview(
        mockVault.id,
        mockConnection.id,
        'prj_123',
        'production',
        'production',
        'pull',
        false,
        mockUser.id
      );

      expect(preview).toHaveProperty('toCreate');
      expect(Array.isArray(preview.toCreate)).toBe(true);
    });
  });

  describe('ConnectionInfo type', () => {
    it('should have expected properties', async () => {
      const { listConnections } = await import('../src/services/integration.service');

      const connections = await listConnections(mockUser.id);
      const connection = connections[0];

      // Verify shape matches ConnectionInfo interface
      expect(connection).toHaveProperty('id');
      expect(connection).toHaveProperty('provider');
      expect(connection).toHaveProperty('providerUserId');
      expect(connection).toHaveProperty('providerTeamId');
      expect(connection).toHaveProperty('createdAt');
      expect(connection).toHaveProperty('updatedAt');

      // Verify sensitive data is NOT exposed
      expect(connection).not.toHaveProperty('encryptedAccessToken');
      expect(connection).not.toHaveProperty('accessTokenIv');
    });
  });
});
