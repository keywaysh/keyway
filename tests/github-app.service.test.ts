import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

// Mock the config before importing the service
vi.mock('../src/config', () => ({
  config: {
    githubApp: {
      appId: '123456',
      privateKey: `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MfszK1RfoYjBfOGO
vulAwJshbT4bKwXH8sxuG8w0CuTx2aQBrVAWryvMmGV1eXOvX9/OLB9kGQQqPBke
lYUJpf2P1s+TBrxGKSaLM7qFGVMkPFti2WZ8zQVKDZqb0s2QGVXGz12X3C5fMOTS
1+nh/gDUJkIZmNr9fMVj2wPn8yvYPmVJ6mWw5wTXXUBxxHyQkHNyV2jD5rqF7E5k
7CfF9Z0yBv3JcQXjIQTBJmQwKIxNqHJHLPQiXdoGQSU5wPOYZxwHRrSviVKGPIMw
TpAMfO2xC9+j/E8t8n7h+P3bVCSz+OkREk5snwIDAQABAoIBAFdCT7jnTDx9tLLQ
uC1R7aVYlFNiSm0E6YvRvI1aeAyD5vXnvL6ZYT9z0a/vHgPbC3IDqKQVCAQSm4YX
zE+Fy2E7K6tCCRrWNmU5wPqDuL2g8Cm9QW3fL0GaX3g0C/V7J0FYkCLsUQAQDpRn
qCQJrFvwG2jXKdMZJ0GCLbPZSXNxTDB7ZlJLVGE9s4DVwBdKXhUh9sJLQCMXgTsH
1MaRkrTQTJvZPiUk3dRYfD/Lq8J+H1eLJ8HgLBCnhQVrj8EIaICoLFBb/sCOTPMA
LIRJ3o0tKdp0Gf5BK7FvPXSXJMYWL0p/UO5bQhLFJZ5K6Y8qPQxQHilVhgYqsQHL
J1R2XwECgYEA9WGQlHvqJMGpPxGrPpnHaH3kFOGdX6tU4XZlPFVE2m8HKEzKEQpN
LfNDJT9JvJcKFVQz6B9gLCYKlRTqBF7K0mQUDJhLLiVvGRHZfH5xGZXAJdHKBtYp
LdCKwqHj8RrLLECXmJMCrVJktDL9LNLbPRgf0agZJk5c7FV3UgOJZfcCgYEA2x2i
gFNo2gD6igLlC3Y2kxaEE7E7BJgFJLPP0mSNK4K0z+E0E6p6Xa0G9K5BUKguJpJh
vnq2G9W2UcKNZsKWJOMAEwKHK0CPlvLMWmLfPgSJWL7r8G3FKH3U0PxLmNEU5R/U
3N7hD2XDVdlbLYD5D9CZPjETQH9k6sL7x5g8kAECgYAxwqFLCFzBK0fiP2H9Kp9L
I8kHOPJFYqFbhFDD3lHJODBY5nT9I4kHLxS7eQ3cF8wKP/kVkLlSV3EX8zq1v0Nj
g0FfJnLtEi9K6VIsAJR7U5UNL/U4Y7NNZF0j7VW5t3g4dJONRaBjJH/pKTlCKGTz
JnLPJCW/a7s5q7UOkl4G4wKBgEEPAVxBVPJBs0LhANoCHHxcH1c1TF9S1Q0qWNuK
h+n0IyHLL7R5A7IHLXj7ySaKPJ1xPmKZK5RYwKM3RXYFyP3p/OVchGzJrcFLCIaO
FFOiJhzwBpJsOaHNZ9UGM5sKUxVrPbN3PZQX7vK6F7xEqE9w3JfNPKAOY8s/V9Dw
g8ABAoGBAMYT8RUhSkDjxlPRYkDBxGagNpBnJ7kKJFHzKpNakBwmUFJFL1BNJ0iN
ntMN0oXnJqAQj+7nh4SFJ3lPZxDLnPWJeBMWqCABj0FfQh0yMYi+PkBVPjsvfrlv
ZZ/7o0eZkBLmWH0EVwPU5D8zN1LKpXDKIqfLTp5cGnvEXdCPVjCM
-----END RSA PRIVATE KEY-----`,
      webhookSecret: 'test-webhook-secret',
      name: 'keyway-test',
      installUrl: 'https://github.com/apps/keyway-test/installations/new',
    },
  },
}));

// Mock the database
const mockInstallation = {
  id: 'inst-uuid-123',
  installationId: 12345678,
  accountId: 98765,
  accountLogin: 'testuser',
  accountType: 'user' as const,
  repositorySelection: 'selected' as const,
  permissions: { metadata: 'read', administration: 'read' },
  status: 'active' as const,
  installedByUserId: 'user-123',
  suspendedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tokenCache: null,
};

const mockInstallationWithCache = {
  ...mockInstallation,
  tokenCache: {
    id: 'token-cache-id',
    installationId: 'inst-uuid-123',
    encryptedToken: 'encrypted-token-data',
    tokenIv: 'iv-data',
    tokenAuthTag: 'auth-tag-data',
    tokenEncryptionVersion: 1,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    createdAt: new Date(),
  },
};

const mockExpiredTokenCache = {
  ...mockInstallation,
  tokenCache: {
    id: 'token-cache-id',
    installationId: 'inst-uuid-123',
    encryptedToken: 'encrypted-token-data',
    tokenIv: 'iv-data',
    tokenAuthTag: 'auth-tag-data',
    tokenEncryptionVersion: 1,
    expiresAt: new Date(Date.now() - 1000), // Already expired
    createdAt: new Date(),
  },
};

const mockRepoEntry = {
  id: 'repo-entry-id',
  installationId: 'inst-uuid-123',
  repoId: 123456,
  repoFullName: 'testuser/test-repo',
  repoPrivate: false,
  installation: mockInstallation,
};

vi.mock('../src/db', () => ({
  db: {
    query: {
      githubAppInstallations: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      githubAppInstallationRepos: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockInstallation]),
        }),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
  githubAppInstallations: { installationId: 'installationId' },
  githubAppInstallationRepos: { repoFullName: 'repoFullName' },
  githubAppInstallationTokens: { installationId: 'installationId' },
}));

// Mock encryption service
vi.mock('../src/utils/encryption', () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: vi.fn().mockResolvedValue({
      encryptedContent: 'encrypted-token',
      iv: 'test-iv',
      authTag: 'test-auth-tag',
      version: 1,
    }),
    decrypt: vi.fn().mockResolvedValue('decrypted-installation-token'),
  }),
}));

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitHub App Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateAppJWT', () => {
    it('should generate a valid JWT with RS256 algorithm', async () => {
      const { generateAppJWT } = await import('../src/services/github-app.service');

      const jwt = generateAppJWT();

      // JWT should have 3 parts separated by dots
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      // Decode and verify header
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');

      // Decode and verify payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.iss).toBe('123456'); // App ID from mock config
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60 + 60); // 10 min + 60s clock skew
    });

    it('should include clock skew tolerance in iat', async () => {
      const { generateAppJWT } = await import('../src/services/github-app.service');

      const now = Math.floor(Date.now() / 1000);
      const jwt = generateAppJWT();

      const parts = jwt.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // iat should be 60 seconds in the past for clock skew
      expect(payload.iat).toBeLessThanOrEqual(now);
      expect(payload.iat).toBeGreaterThanOrEqual(now - 62); // Allow 2 seconds for test execution
    });

    it('should set expiration to 10 minutes', async () => {
      const { generateAppJWT } = await import('../src/services/github-app.service');

      const jwt = generateAppJWT();

      const parts = jwt.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // exp should be ~10 minutes from iat (accounting for clock skew)
      const duration = payload.exp - payload.iat;
      expect(duration).toBe(10 * 60 + 60); // 10 min + 60s skew adjustment
    });

    it('should produce a signature with correct format', async () => {
      const { generateAppJWT } = await import('../src/services/github-app.service');

      const jwt = generateAppJWT();
      const parts = jwt.split('.');

      // Verify signature exists and is base64url encoded
      expect(parts[2]).toBeTruthy();
      expect(parts[2].length).toBeGreaterThan(100); // RSA-SHA256 signatures are typically 256+ bytes base64

      // Verify it doesn't contain standard base64 characters that aren't URL-safe
      expect(parts[2]).not.toContain('+');
      expect(parts[2]).not.toContain('/');
      expect(parts[2]).not.toContain('=');
    });
  });

  describe('getInstallationToken', () => {
    it('should return cached token if valid', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(mockInstallationWithCache);

      const { getInstallationToken } = await import('../src/services/github-app.service');

      const token = await getInstallationToken(12345678);

      expect(token).toBe('decrypted-installation-token');
      expect(mockFetch).not.toHaveBeenCalled(); // Should use cache, not call GitHub
    });

    it('should fetch new token if cache is expired', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(mockExpiredTokenCache);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'new-github-token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      const { getInstallationToken } = await import('../src/services/github-app.service');

      const token = await getInstallationToken(12345678);

      expect(token).toBe('new-github-token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/12345678/access_tokens',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should fetch new token if no cache exists', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(mockInstallation);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'fresh-github-token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      const { getInstallationToken } = await import('../src/services/github-app.service');

      const token = await getInstallationToken(12345678);

      expect(token).toBe('fresh-github-token');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should throw NotFoundError if installation does not exist', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      const { getInstallationToken } = await import('../src/services/github-app.service');

      await expect(getInstallationToken(99999999)).rejects.toThrow('Installation 99999999 not found');
    });

    it('should throw error if GitHub API fails', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(mockInstallation);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Installation not found',
      });

      const { getInstallationToken } = await import('../src/services/github-app.service');

      await expect(getInstallationToken(12345678)).rejects.toThrow('Failed to get installation token: 404');
    });

    it('should refresh token within 5 minute buffer of expiration', async () => {
      const { db } = await import('../src/db');

      // Token expires in 4 minutes (within 5 min buffer)
      const almostExpiredCache = {
        ...mockInstallation,
        tokenCache: {
          ...mockInstallationWithCache.tokenCache,
          expiresAt: new Date(Date.now() + 4 * 60 * 1000), // 4 minutes from now
        },
      };
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(almostExpiredCache);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'refreshed-token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      const { getInstallationToken } = await import('../src/services/github-app.service');

      const token = await getInstallationToken(12345678);

      expect(token).toBe('refreshed-token');
      expect(mockFetch).toHaveBeenCalled(); // Should fetch new token
    });
  });

  describe('findInstallationForRepo', () => {
    it('should find installation by repo entry (selected repos)', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(mockRepoEntry);

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      const installation = await findInstallationForRepo('testuser', 'test-repo');

      expect(installation).toEqual(mockInstallation);
    });

    it('should find installation by account for "all repos" selection', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);

      const allReposInstallation = {
        ...mockInstallation,
        repositorySelection: 'all' as const,
      };
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(allReposInstallation);

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      const installation = await findInstallationForRepo('testuser', 'any-repo');

      expect(installation).toEqual(allReposInstallation);
    });

    it('should return null if no installation found', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      const installation = await findInstallationForRepo('unknown', 'repo');

      expect(installation).toBeNull();
    });

    it('should not return suspended installations', async () => {
      const { db } = await import('../src/db');
      const suspendedRepoEntry = {
        ...mockRepoEntry,
        installation: {
          ...mockInstallation,
          status: 'suspended' as const,
        },
      };
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(suspendedRepoEntry);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      const installation = await findInstallationForRepo('testuser', 'test-repo');

      expect(installation).toBeNull();
    });

    it('should find installation via GitHub API when DB lookup fails', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      // Mock GitHub API response
      const mockApiResponse = {
        id: 99999,
        account: { id: 12345, login: 'neworg', type: 'Organization' },
        repository_selection: 'all',
        permissions: { metadata: 'read', contents: 'read' },
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      });

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      const installation = await findInstallationForRepo('neworg', 'some-repo');

      expect(installation).not.toBeNull();
      expect(installation?.installationId).toBe(99999);
      expect(installation?.accountLogin).toBe('neworg');
      expect(installation?.accountType).toBe('organization');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/neworg/some-repo/installation',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.github.v3+json',
          }),
        })
      );
    });

    it('should return null when GitHub API returns 404', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      // Mock GitHub API 404 response
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      const installation = await findInstallationForRepo('unknown', 'repo');

      expect(installation).toBeNull();
    });

    it('should sync installation to DB when found via API', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      // Mock GitHub API response
      const mockApiResponse = {
        id: 88888,
        account: { id: 11111, login: 'synctest', type: 'User' },
        repository_selection: 'selected',
        permissions: { metadata: 'read' },
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      });

      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      await findInstallationForRepo('synctest', 'test-repo');

      // Verify createInstallation was called (via db.insert)
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('checkInstallationStatus', () => {
    it('should return installed: true when installation exists', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(mockRepoEntry);

      const { checkInstallationStatus } = await import('../src/services/github-app.service');

      const status = await checkInstallationStatus('testuser', 'test-repo');

      expect(status.installed).toBe(true);
      expect(status.installationId).toBe(12345678);
      expect(status.installUrl).toContain('github.com/apps');
    });

    it('should return installed: false when no installation', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      // Mock GitHub API to return 404 (app not installed)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { checkInstallationStatus } = await import('../src/services/github-app.service');

      const status = await checkInstallationStatus('unknown', 'repo');

      expect(status.installed).toBe(false);
      expect(status.installationId).toBeUndefined();
      expect(status.installUrl).toBeDefined();
    });
  });

  describe('assertRepoAccessViaApp', () => {
    it('should return installation info when app is installed', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(mockRepoEntry);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(mockInstallationWithCache);

      const { assertRepoAccessViaApp } = await import('../src/services/github-app.service');

      const result = await assertRepoAccessViaApp('testuser', 'test-repo');

      expect(result.installationId).toBe(12345678);
      expect(result.token).toBe('decrypted-installation-token');
    });

    it('should throw ForbiddenError when app is not installed', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallationRepos.findFirst as any).mockResolvedValue(null);
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(null);

      // Mock GitHub API to return 404 (app not installed)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { assertRepoAccessViaApp } = await import('../src/services/github-app.service');

      await expect(assertRepoAccessViaApp('unknown', 'repo')).rejects.toThrow('GitHub App not installed');
    });
  });

  describe('createInstallation', () => {
    it('should create installation record with repos', async () => {
      const { db } = await import('../src/db');

      const { createInstallation } = await import('../src/services/github-app.service');

      const result = await createInstallation({
        installationId: 12345678,
        accountId: 98765,
        accountLogin: 'testuser',
        accountType: 'user',
        repositorySelection: 'selected',
        permissions: { metadata: 'read' },
        repositories: [
          { id: 123, full_name: 'testuser/repo1', private: false },
          { id: 456, full_name: 'testuser/repo2', private: true },
        ],
      });

      expect(result).toBeDefined();
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('deleteInstallation', () => {
    it('should mark installation as deleted and clear token cache', async () => {
      const { db } = await import('../src/db');
      (db.query.githubAppInstallations.findFirst as any).mockResolvedValue(mockInstallation);

      const { deleteInstallation } = await import('../src/services/github-app.service');

      await deleteInstallation(12345678);

      expect(db.update).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('updateInstallationStatus', () => {
    it('should update status to suspended with timestamp', async () => {
      const { db } = await import('../src/db');

      const { updateInstallationStatus } = await import('../src/services/github-app.service');

      await updateInstallationStatus(12345678, 'suspended');

      expect(db.update).toHaveBeenCalled();
    });

    it('should clear suspendedAt when status is active', async () => {
      const { db } = await import('../src/db');

      const { updateInstallationStatus } = await import('../src/services/github-app.service');

      await updateInstallationStatus(12345678, 'active');

      expect(db.update).toHaveBeenCalled();
    });
  });
});
