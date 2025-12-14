import { vi } from 'vitest';

/**
 * Mock user data for testing
 * Note: plan defaults to 'pro' for tests to avoid limit checks
 * Tests that need to verify limit enforcement should explicitly use mockFreeUser
 */
export const mockUser = {
  id: 'test-user-id-123',
  githubId: 12345,
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
 * Mock vault data for testing
 */
export const mockVault = {
  id: 'test-vault-id-123',
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
 * Mock secret data for testing
 */
export const mockSecret = {
  id: 'test-secret-id-123',
  vaultId: mockVault.id,
  name: 'API_KEY',
  encryptedValue: 'encrypted-value',
  iv: '0'.repeat(32),
  authTag: '0'.repeat(32),
  environment: 'development',
  createdById: mockUser.id,
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
  };

  // Create chainable insert/update/delete methods
  const createChain = (returnValue: any) => ({
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returnValue]),
  });

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
      // Create a transaction mock that has the same methods as db
      const txMock = {
        update: vi.fn().mockReturnValue(createChain(mockUser)),
        delete: vi.fn().mockReturnValue(createChain(null)),
        insert: vi.fn().mockReturnValue(createChain(mockUser)),
      };
      return callback(txMock);
    }),
  };

  return dbMock;
}

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
      githubId: mockGitHubResponses.user.id,
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
