import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { mockUser, mockDeviceCode, createMockDb, createMockGitHubUtils } from '../helpers/mocks';
import { signState, verifyState } from '../../src/utils/state';

// Mock installation data
const mockInstallation = {
  id: 'inst-uuid-123',
  installationId: 12345678,
  accountId: 98765,
  accountLogin: 'testuser',
  accountType: 'user' as const,
  repositorySelection: 'selected' as const,
  permissions: { metadata: 'read', administration: 'read' },
  status: 'active' as const,
  installedByUserId: mockUser.id,
  suspendedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tokenCache: null,
};

// Create base mock DB
const baseMockDb = createMockDb();

// Mock the database module
vi.mock('../../src/db', () => {
  return {
    db: {
      ...baseMockDb,
      query: {
        ...baseMockDb.query,
        githubAppInstallations: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        githubAppInstallationRepos: {
          findFirst: vi.fn(),
        },
      },
    },
    users: { id: 'id', githubId: 'githubId' },
    vaults: { id: 'id', repoFullName: 'repoFullName', ownerId: 'ownerId' },
    secrets: { id: 'id' },
    deviceCodes: { id: 'id', deviceCode: 'deviceCode', userCode: 'userCode', status: 'status' },
    githubAppInstallations: { installationId: 'installationId', accountLogin: 'accountLogin' },
    githubAppInstallationRepos: { repoFullName: 'repoFullName' },
  };
});

// Mock GitHub utils
vi.mock('../../src/utils/github', () => createMockGitHubUtils());

// Mock GitHub App service
vi.mock('../../src/services/github-app.service', () => ({
  handleInstallationCreated: vi.fn().mockResolvedValue(mockInstallation),
  findInstallationForRepo: vi.fn().mockResolvedValue(mockInstallation),
  getInstallationToken: vi.fn().mockResolvedValue('ghs_mock_installation_token'),
  checkInstallationStatus: vi.fn().mockResolvedValue({
    installed: true,
    installationId: 12345678,
    installUrl: 'https://github.com/apps/keyway-test/installations/new',
  }),
}));

// Mock analytics (no-op)
vi.mock('../../src/utils/analytics', () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  getSignupSource: vi.fn().mockReturnValue('github_app_install'),
  AnalyticsEvents: {
    AUTH_SUCCESS: 'api_auth_success',
    AUTH_FAILURE: 'api_auth_failure',
    USER_CREATED: 'api_user_created',
  },
}));

// Mock email
vi.mock('../../src/utils/email', () => ({
  sendWelcomeEmail: vi.fn(),
  sendTrialStartedEmail: vi.fn(),
}));

// Mock token encryption
vi.mock('../../src/utils/tokenEncryption', () => ({
  encryptAccessToken: vi.fn().mockResolvedValue({
    encryptedAccessToken: 'encrypted-token',
    accessTokenIv: 'iv',
    accessTokenAuthTag: 'auth-tag',
    tokenEncryptionVersion: 1,
  }),
  decryptAccessToken: vi.fn().mockResolvedValue('gho_decrypted_token'),
}));

describe('GitHub App Installation Flow (End-to-End)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });
    await app.register(formbody);
    await app.register(cookie);

    // Import and register auth routes after mocks are set up
    const { authRoutes } = await import('../../src/api/v1/routes/auth.routes');
    await app.register(authRoutes, { prefix: '/v1/auth' });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Device Flow with GitHub App Installation', () => {
    it('should include githubAppInstallUrl with state in device/start response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/start',
        payload: {},
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('githubAppInstallUrl');
      expect(body.githubAppInstallUrl).toContain('state=');

      // Verify state is properly encoded
      const url = new URL(body.githubAppInstallUrl);
      const state = url.searchParams.get('state');
      expect(state).toBeTruthy();
    });

    it('should include suggested repository in device/start when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/start',
        payload: {
          repository: 'testuser/test-repo',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GitHub App Callback with State Parameter', () => {
    it('should include state parameter with deviceCodeId in format base64url.base64url', async () => {
      // Test that state is properly formatted when generated
      const deviceCodeId = 'test-device-code-uuid';
      const state = signState({
        deviceCodeId,
        type: 'github_app_install',
      });

      // State should be in format: base64url(payload).base64url(signature)
      const parts = state.split('.');
      expect(parts).toHaveLength(2);

      // Verify the state can be decoded and verified
      const verified = verifyState(state);
      expect(verified).toBeTruthy();
      expect(verified?.deviceCodeId).toBe(deviceCodeId);
      expect(verified?.type).toBe('github_app_install');
    });

    it('should handle tampered state by returning null from verifyState', () => {
      const deviceCodeId = 'test-device-code-uuid';
      const state = signState({
        deviceCodeId,
        type: 'github_app_install',
      });

      // Tamper with the state
      const [payload, signature] = state.split('.');
      const tamperedState = `${payload}.invalid_signature`;

      // verifyState should return null for tampered state
      const verified = verifyState(tamperedState);
      expect(verified).toBeNull();
    });
  });

  describe('Device Flow Polling After Installation', () => {
    it('should return approved status with token after successful installation', async () => {
      const { db } = await import('../../src/db');

      // Mock approved device code with user
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'approved',
        userId: mockUser.id,
        user: mockUser,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: {
          deviceCode: 'DEVICE123456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('approved');
      expect(body).toHaveProperty('keywayToken');
      expect(body).toHaveProperty('githubLogin');
      expect(body.githubLogin).toBe('testuser');
    });

    it('should auto-approve oauth_complete device code when installation is detected via poll', async () => {
      const { db } = await import('../../src/db');
      const { checkInstallationStatus } = await import('../../src/services/github-app.service');

      // Mock oauth_complete device code (OAuth done, waiting for GitHub App)
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        id: 'oauth-complete-device-code',
        status: 'oauth_complete',
        userId: mockUser.id,
        suggestedRepository: 'testuser/test-repo',
      });

      // Mock user lookup
      (db.query.users.findFirst as any).mockResolvedValue(mockUser);

      // Mock installation now available (user completed GitHub App install)
      (checkInstallationStatus as any).mockResolvedValue({
        installed: true,
        installationId: 12345678,
        installUrl: 'https://github.com/apps/keyway-test/installations/new',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: {
          deviceCode: 'DEVICE123456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('approved');
      expect(body).toHaveProperty('keywayToken');
      expect(body).toHaveProperty('githubLogin');
      expect(body.githubLogin).toBe('testuser');

      // Verify device code was updated to approved
      expect(db.update).toHaveBeenCalled();
    });

    it('should return pending for oauth_complete when installation not yet available', async () => {
      const { db } = await import('../../src/db');
      const { checkInstallationStatus } = await import('../../src/services/github-app.service');

      // Mock oauth_complete device code
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
        suggestedRepository: 'testuser/test-repo',
      });

      // Mock installation NOT yet available
      (checkInstallationStatus as any).mockResolvedValue({
        installed: false,
        installUrl: 'https://github.com/apps/keyway-test/installations/new',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: {
          deviceCode: 'DEVICE123456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('pending');
      expect(body).not.toHaveProperty('keywayToken');
    });

    it('should return pending for oauth_complete without suggestedRepository', async () => {
      const { db } = await import('../../src/db');

      // Mock oauth_complete device code without suggestedRepository
      (db.query.deviceCodes.findFirst as any).mockResolvedValue({
        ...mockDeviceCode,
        status: 'oauth_complete',
        userId: mockUser.id,
        suggestedRepository: null, // No repository suggestion
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/poll',
        payload: {
          deviceCode: 'DEVICE123456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('pending');
    });
  });
});

describe('State Parameter Security', () => {
  it('should sign and verify state correctly', () => {
    const payload = {
      deviceCodeId: 'test-uuid-123',
      type: 'github_app_install',
    };

    const signed = signState(payload);
    expect(signed).toBeTruthy();
    expect(typeof signed).toBe('string');
    // State format is: base64url(payload).base64url(signature)
    expect(signed.split('.')).toHaveLength(2);

    const verified = verifyState(signed);
    expect(verified).toBeTruthy();
    // Verified data includes exp field added by signState
    expect(verified?.deviceCodeId).toBe(payload.deviceCodeId);
    expect(verified?.type).toBe(payload.type);
    expect(verified?.exp).toBeDefined();
  });

  it('should reject tampered state', () => {
    const payload = {
      deviceCodeId: 'test-uuid-123',
      type: 'github_app_install',
    };

    const signed = signState(payload);

    // Tamper with the payload part
    const [payloadPart, signature] = signed.split('.');
    const tampered = `${payloadPart}x.${signature}`;

    // verifyState returns null for invalid signatures (doesn't throw)
    const result = verifyState(tampered);
    expect(result).toBeNull();
  });

  it('should reject expired state', () => {
    const payload = {
      deviceCodeId: 'test-uuid-123',
      type: 'github_app_install',
    };

    // Sign with 0ms TTL (already expired)
    const signed = signState(payload, -1000);
    const verified = verifyState(signed);

    // Should return null for expired state
    expect(verified).toBeNull();
  });
});
