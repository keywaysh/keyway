import { vi } from 'vitest';

/**
 * Mock user data for testing
 * Note: plan defaults to 'pro' for tests to avoid limit checks
 * Tests that need to verify limit enforcement should explicitly use mockFreeUser
 */
export const mockUser = {
  id: 'test-user-id-123',
  forgeType: 'github' as const,
  forgeUserId: '12345',
  username: 'testuser',
  email: 'test@example.com',
  avatarUrl: 'https://github.com/testuser.png',
  accessToken: 'gho_testtoken123',
  plan: 'pro' as const,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Mock Free plan user for testing plan limits
 */
export const mockFreeUser = {
  ...mockUser,
  id: 'test-free-user-id',
  plan: 'free' as const,
};

/**
 * Mock organization data for testing
 */
export const mockOrganization = {
  id: 'test-org-id-123',
  forgeType: 'github' as const,
  forgeOrgId: '98765',
  login: 'test-org',
  displayName: 'Test Organization',
  avatarUrl: 'https://github.com/test-org.png',
  plan: 'free' as const,
  stripeCustomerId: null,
  trialStartedAt: null,
  trialEndsAt: null,
  trialConvertedAt: null,
  defaultPermissions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Mock organization on active trial
 */
export const mockOrgOnTrial = {
  ...mockOrganization,
  id: 'test-org-trial-id',
  plan: 'team' as const,
  trialStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
  trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
};

/**
 * Mock organization with expired trial
 */
export const mockOrgExpiredTrial = {
  ...mockOrganization,
  id: 'test-org-expired-trial-id',
  plan: 'team' as const,
  trialStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
  trialEndsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago (expired)
};

/**
 * Mock organization with paid Team plan
 */
export const mockOrgPaid = {
  ...mockOrganization,
  id: 'test-org-paid-id',
  plan: 'team' as const,
  stripeCustomerId: 'cus_test123',
  trialStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
  trialEndsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  trialConvertedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
};

/**
 * Mock vault data for testing
 */
export const mockVault = {
  id: 'test-vault-id-123',
  forgeType: 'github' as const,
  repoOwner: 'testuser',
  repoName: 'test-repo',
  repoFullName: 'testuser/test-repo',
  isPrivate: false,
  environments: ['local', 'dev', 'staging', 'production'],
  ownerId: mockUser.id,
  createdById: mockUser.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Mock vault environments for the new vault_environments table
 */
export const mockVaultEnvironments = [
  { id: 'env-1', vaultId: mockVault.id, name: 'development', type: 'development' as const, displayOrder: 0 },
  { id: 'env-2', vaultId: mockVault.id, name: 'staging', type: 'standard' as const, displayOrder: 1 },
  { id: 'env-3', vaultId: mockVault.id, name: 'production', type: 'protected' as const, displayOrder: 2 },
];

/**
 * Mock secret data for testing
 */
export const mockSecret = {
  id: 'test-secret-id-123',
  vaultId: mockVault.id,
  key: 'API_KEY',
  encryptedValue: 'encrypted-value',
  iv: '0'.repeat(32),
  authTag: '0'.repeat(32),
  encryptionVersion: 1,
  environment: 'development',
  createdById: mockUser.id,
  lastModifiedById: mockUser.id,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Mock secret list item with lastModifiedBy info
 */
export const mockSecretListItem = {
  id: 'test-secret-id-123',
  key: 'API_KEY',
  environment: 'development',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastModifiedBy: {
    username: mockUser.username,
    avatarUrl: mockUser.avatarUrl,
  },
};

/**
 * Mock secret list item without lastModifiedBy (legacy secret)
 */
export const mockLegacySecretListItem = {
  id: 'test-legacy-secret-id',
  key: 'LEGACY_KEY',
  environment: 'production',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastModifiedBy: null,
};

/**
 * Mock API key data for testing
 */
export const mockApiKey = {
  id: 'test-api-key-id-123',
  userId: mockUser.id,
  name: 'Test API Key',
  keyPrefix: 'kw_live_abc123',
  keyHash: 'hashed-key-value',
  environment: 'live' as const,
  scopes: ['read:secrets', 'write:secrets'],
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
  lastUsedAt: null,
  usageCount: 0,
  allowedIps: null,
  revokedAt: null,
  revokedReason: null,
  createdFromIp: '127.0.0.1',
  createdUserAgent: 'test-agent',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Mock API key with read-only scope
 */
export const mockApiKeyReadOnly = {
  ...mockApiKey,
  id: 'test-api-key-readonly-id',
  name: 'Read Only API Key',
  scopes: ['read:secrets'],
};

/**
 * Mock API key with admin scope only
 */
export const mockApiKeyAdminOnly = {
  ...mockApiKey,
  id: 'test-api-key-admin-id',
  name: 'Admin Only API Key',
  scopes: ['admin:api-keys'],
};

/**
 * Mock device code data for testing
 */
export const mockDeviceCode = {
  id: 'test-device-code-id-123',
  deviceCode: 'DEVICE123456',
  userCode: 'ABCD-1234',
  status: 'pending' as const,
  userId: null,
  suggestedRepository: null,
  expiresAt: new Date(Date.now() + 900000), // 15 minutes from now
  createdAt: new Date(),
};

/**
 * Create a mock database query builder
 * This returns chainable methods that resolve to mock data
 */
export function createMockDb(overrides: {
  users?: typeof mockUser | null;
  vaults?: typeof mockVault | null;
  secrets?: typeof mockSecret[];
  deviceCodes?: typeof mockDeviceCode | null;
  vaultEnvironments?: typeof mockVaultEnvironments;
} = {}) {
  const mockQuery = {
    users: {
      findFirst: vi.fn().mockResolvedValue(overrides.users ?? mockUser),
      findMany: vi.fn().mockResolvedValue(overrides.users ? [overrides.users] : [mockUser]),
    },
    vaults: {
      findFirst: vi.fn().mockResolvedValue(overrides.vaults ?? mockVault),
      findMany: vi.fn().mockResolvedValue(overrides.vaults ? [overrides.vaults] : [mockVault]),
    },
    secrets: {
      findFirst: vi.fn().mockResolvedValue(overrides.secrets?.[0] ?? mockSecret),
      findMany: vi.fn().mockResolvedValue(overrides.secrets ?? [mockSecret]),
    },
    deviceCodes: {
      findFirst: vi.fn().mockResolvedValue(overrides.deviceCodes ?? mockDeviceCode),
    },
    vaultEnvironments: {
      findFirst: vi.fn().mockResolvedValue(overrides.vaultEnvironments?.[0] ?? mockVaultEnvironments[0]),
      findMany: vi.fn().mockResolvedValue(overrides.vaultEnvironments ?? mockVaultEnvironments),
    },
  };

  // Create chainable insert/update/delete methods
  // values() and where() must be thenable for operations without .returning()
  const createChain = (returnValue: any) => {
    const createThenable = () => {
      const result = Promise.resolve(undefined);
      (result as any).returning = vi.fn().mockResolvedValue([returnValue]);
      (result as any).onConflictDoNothing = vi.fn().mockReturnValue(result);
      (result as any).onConflictDoUpdate = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([returnValue]),
      });
      return result;
    };

    return {
      values: vi.fn().mockImplementation(createThenable),
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(createThenable),
      }),
      where: vi.fn().mockImplementation(createThenable),
      returning: vi.fn().mockResolvedValue([returnValue]),
    };
  };

  const dbMock = {
    query: mockQuery,
    insert: vi.fn().mockReturnValue(createChain(mockUser)),
    update: vi.fn().mockReturnValue(createChain(mockUser)),
    delete: vi.fn().mockReturnValue(createChain(null)),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    // Transaction support - execute callback with same mock
    transaction: vi.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      // Create thenable for chainable operations
      const createTxThenable = () => Promise.resolve(undefined);
      // Create a transaction mock that has the same methods as db
      const txMock = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(createTxThenable),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(createTxThenable),
        }),
        insert: vi.fn().mockImplementation(() => {
          const result = createTxThenable();
          (result as any).values = vi.fn().mockImplementation(() => {
            const valuesResult = createTxThenable();
            (valuesResult as any).returning = vi.fn().mockResolvedValue([mockUser]);
            return valuesResult;
          });
          return result;
        }),
      };
      return callback(txMock);
    }),
  };

  return dbMock;
}

/**
 * Mock secret access data for Exposure feature testing
 */
export const mockSecretAccess = {
  id: 'test-access-id-123',
  userId: mockUser.id,
  username: mockUser.username,
  userAvatarUrl: mockUser.avatarUrl,
  secretId: mockSecret.id,
  secretKey: mockSecret.key,
  vaultId: mockVault.id,
  repoFullName: mockVault.repoFullName,
  environment: mockSecret.environment,
  githubRole: 'admin' as const,
  platform: 'cli' as const,
  ipAddress: '127.0.0.1',
  deviceId: 'device-123',
  firstAccessedAt: new Date(),
  lastAccessedAt: new Date(),
  accessCount: 1,
  pullEventId: null,
};

/**
 * Mock GitHub API responses
 */
export const mockGitHubResponses = {
  user: {
    id: 12345,
    login: 'testuser',
    email: 'test@example.com',
    avatar_url: 'https://github.com/testuser.png',
  },
  repo: {
    private: false,
    owner: { login: 'testuser' },
    permissions: {
      pull: true,
      push: true,
      admin: true,
    },
  },
  accessToken: 'gho_testtoken123',
};

/**
 * Create mock GitHub utils
 */
export function createMockGitHubUtils() {
  return {
    exchangeCodeForToken: vi.fn().mockResolvedValue(mockGitHubResponses.accessToken),
    getGitHubUser: vi.fn().mockResolvedValue(mockGitHubResponses.user),
    getUserFromToken: vi.fn().mockResolvedValue({
      forgeType: 'github' as const,
      forgeUserId: String(mockGitHubResponses.user.id),
      username: mockGitHubResponses.user.login,
      email: mockGitHubResponses.user.email,
      avatarUrl: mockGitHubResponses.user.avatar_url,
    }),
    hasRepoAccess: vi.fn().mockResolvedValue(true),
    hasAdminAccess: vi.fn().mockResolvedValue(true),
    getRepoPermission: vi.fn().mockResolvedValue('admin'),
    getRepoAccessAndPermission: vi.fn().mockResolvedValue({ hasAccess: true, permission: 'admin' }),
    getUserRole: vi.fn().mockResolvedValue('admin'),
    getRepoInfo: vi.fn().mockResolvedValue({ isPrivate: false }),
    // GitHub App-powered functions (used by current codebase)
    getRepoInfoWithApp: vi.fn().mockResolvedValue({ isPrivate: false, isOrganization: false }),
    getUserRoleWithApp: vi.fn().mockResolvedValue('admin'),
    getRepoCollaboratorsWithApp: vi.fn().mockResolvedValue([]),
  };
}
