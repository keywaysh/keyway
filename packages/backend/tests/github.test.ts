import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRepoCollaborators, getUserRole } from '../src/utils/github';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the github-app.service for getUserRoleWithApp tests
vi.mock('../src/services/github-app.service', () => ({
  findInstallationForRepo: vi.fn(),
  getInstallationToken: vi.fn(),
}));

describe('GitHub Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getRepoCollaborators', () => {
    const accessToken = 'test-access-token';
    const owner = 'test-owner';
    const repo = 'test-repo';

    it('should return collaborators with mapped permissions', async () => {
      const mockCollaborators = [
        {
          login: 'admin-user',
          avatar_url: 'https://avatars.githubusercontent.com/admin-user',
          html_url: 'https://github.com/admin-user',
          role_name: 'admin',
        },
        {
          login: 'write-user',
          avatar_url: 'https://avatars.githubusercontent.com/write-user',
          html_url: 'https://github.com/write-user',
          role_name: 'push',
        },
        {
          login: 'read-user',
          avatar_url: 'https://avatars.githubusercontent.com/read-user',
          html_url: 'https://github.com/read-user',
          role_name: 'pull',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCollaborators,
      });

      const result = await getRepoCollaborators(accessToken, owner, repo);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        login: 'admin-user',
        avatarUrl: 'https://avatars.githubusercontent.com/admin-user',
        htmlUrl: 'https://github.com/admin-user',
        permission: 'admin',
      });
      expect(result[1]).toEqual({
        login: 'write-user',
        avatarUrl: 'https://avatars.githubusercontent.com/write-user',
        htmlUrl: 'https://github.com/write-user',
        permission: 'write',
      });
      expect(result[2]).toEqual({
        login: 'read-user',
        avatarUrl: 'https://avatars.githubusercontent.com/read-user',
        htmlUrl: 'https://github.com/read-user',
        permission: 'read',
      });
    });

    it('should map all GitHub role names correctly', async () => {
      const mockCollaborators = [
        { login: 'user1', avatar_url: '', html_url: '', role_name: 'admin' },
        { login: 'user2', avatar_url: '', html_url: '', role_name: 'maintain' },
        { login: 'user3', avatar_url: '', html_url: '', role_name: 'push' },
        { login: 'user4', avatar_url: '', html_url: '', role_name: 'triage' },
        { login: 'user5', avatar_url: '', html_url: '', role_name: 'pull' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCollaborators,
      });

      const result = await getRepoCollaborators(accessToken, owner, repo);

      expect(result.find((c) => c.login === 'user1')?.permission).toBe('admin');
      expect(result.find((c) => c.login === 'user2')?.permission).toBe('maintain');
      expect(result.find((c) => c.login === 'user3')?.permission).toBe('write');
      expect(result.find((c) => c.login === 'user4')?.permission).toBe('triage');
      expect(result.find((c) => c.login === 'user5')?.permission).toBe('read');
    });

    it('should handle empty collaborators list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await getRepoCollaborators(accessToken, owner, repo);

      expect(result).toEqual([]);
    });

    it('should handle pagination correctly', async () => {
      // First page - 100 items (full page)
      const firstPage = Array.from({ length: 100 }, (_, i) => ({
        login: `user-${i}`,
        avatar_url: `https://avatars.githubusercontent.com/user-${i}`,
        html_url: `https://github.com/user-${i}`,
        role_name: 'push',
      }));

      // Second page - 50 items (partial page, indicates end)
      const secondPage = Array.from({ length: 50 }, (_, i) => ({
        login: `user-${100 + i}`,
        avatar_url: `https://avatars.githubusercontent.com/user-${100 + i}`,
        html_url: `https://github.com/user-${100 + i}`,
        role_name: 'pull',
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => firstPage,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => secondPage,
        });

      const result = await getRepoCollaborators(accessToken, owner, repo);

      expect(result).toHaveLength(150);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('page=1'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('page=2'),
        expect.any(Object)
      );
    });

    it('should throw error when user lacks admin access', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(getRepoCollaborators(accessToken, owner, repo)).rejects.toThrow(
        'Admin access required to view collaborators'
      );
    });

    it('should throw error on other API failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(getRepoCollaborators(accessToken, owner, repo)).rejects.toThrow(
        'Failed to fetch collaborators: Internal Server Error'
      );
    });

    it('should default unknown roles to read permission', async () => {
      const mockCollaborators = [
        { login: 'user1', avatar_url: '', html_url: '', role_name: 'unknown_role' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCollaborators,
      });

      const result = await getRepoCollaborators(accessToken, owner, repo);

      expect(result[0].permission).toBe('read');
    });

    it('should include correct authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await getRepoCollaborators(accessToken, owner, repo);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          }),
        })
      );
    });
  });

  describe('getUserRole', () => {
    const accessToken = 'test-access-token';
    const repoFullName = 'testuser/test-repo';
    const username = 'testuser';

    it('should return admin for repository owner (same as username)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'testuser' },
          permissions: { admin: true, push: true, pull: true },
        }),
      });

      const result = await getUserRole(accessToken, repoFullName, username);

      expect(result).toBe('admin');
    });

    it('should return admin when repo owner matches URL owner', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'someorg' },
          permissions: { admin: false, push: true, pull: true },
        }),
      });

      // When username matches the owner part of repoFullName
      const result = await getUserRole(accessToken, 'testuser/other-repo', 'testuser');

      expect(result).toBe('admin');
    });

    it('should return admin when permissions.admin is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'someorg' },
          permissions: { admin: true, push: true, pull: true },
        }),
      });

      const result = await getUserRole(accessToken, 'someorg/test-repo', 'other-user');

      expect(result).toBe('admin');
    });

    it('should return write when user has push permission', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'someorg' },
            permissions: { admin: false, push: true, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            role_name: 'push',
            permissions: { push: true, pull: true, admin: false },
          }),
        });

      const result = await getUserRole(accessToken, 'someorg/test-repo', 'contributor');

      expect(result).toBe('write');
    });

    it('should return read when user only has pull permission', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'someorg' },
            permissions: { admin: false, push: false, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        });

      const result = await getUserRole(accessToken, 'someorg/test-repo', 'reader');

      expect(result).toBe('read');
    });

    it('should return null when user has no access', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await getUserRole(accessToken, 'private/repo', 'stranger');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await getUserRole(accessToken, repoFullName, username);

      expect(result).toBeNull();
    });

    it('should handle collaborator API returning detailed role', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'someorg' },
            permissions: { admin: false, push: true, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            role_name: 'maintain',
            permissions: { push: true, pull: true, admin: false },
          }),
        });

      const result = await getUserRole(accessToken, 'someorg/test-repo', 'maintainer');

      expect(result).toBe('maintain');
    });

    it('should handle triage role correctly', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'someorg' },
            permissions: { admin: false, push: false, pull: true, triage: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            role_name: 'triage',
            permissions: { push: false, pull: true, admin: false },
          }),
        });

      const result = await getUserRole(accessToken, 'someorg/test-repo', 'triager');

      expect(result).toBe('triage');
    });

    it('should call the /permission endpoint (not just /collaborators/{username})', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'someorg' },
            permissions: { admin: false, push: false, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            permission: 'write',
            role_name: 'push',
          }),
        });

      await getUserRole(accessToken, 'someorg/test-repo', 'collaborator');

      // Verify the second call is to the /permission endpoint
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/someorg/test-repo/collaborators/collaborator/permission',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${accessToken}`,
          }),
        })
      );
    });

    it('should handle collaborator with write access when repo API shows no push permission', async () => {
      // This tests the key scenario: user is a collaborator but the repo API
      // (which may use App token) doesn't show their push permission directly
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'anotheruser' },
            permissions: { admin: false, push: false, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            permission: 'write',
            role_name: 'push',
          }),
        });

      const result = await getUserRole(accessToken, 'anotheruser/repo', 'collaborator');

      expect(result).toBe('write');
    });

    it('should fallback to permission field when role_name is missing', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'someorg' },
            permissions: { admin: false, push: false, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            permission: 'admin',
            // role_name could be missing in some edge cases
          }),
        });

      const result = await getUserRole(accessToken, 'someorg/repo', 'user');

      expect(result).toBe('admin');
    });

    it('should return read for collaborator with pull-only permission', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            owner: { login: 'otheruser' },
            permissions: { admin: false, push: false, pull: true },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            permission: 'read',
            role_name: 'pull',
          }),
        });

      const result = await getUserRole(accessToken, 'otheruser/repo', 'reader');

      expect(result).toBe('read');
    });
  });

  describe('getUserRoleWithApp', () => {
    it('should use GitHub App installation token', async () => {
      const { findInstallationForRepo, getInstallationToken } = await import(
        '../src/services/github-app.service'
      );

      (findInstallationForRepo as any).mockResolvedValue({
        id: 'inst-123',
        installationId: 12345678,
        accountLogin: 'testuser',
        status: 'active',
      });
      (getInstallationToken as any).mockResolvedValue('ghs_installation_token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'testuser' },
          permissions: { admin: true, push: true, pull: true },
        }),
      });

      const { getUserRoleWithApp } = await import('../src/utils/github');

      const result = await getUserRoleWithApp('testuser/test-repo', 'testuser');

      expect(result).toBe('admin');
      expect(getInstallationToken).toHaveBeenCalledWith(12345678);
    });

    it('should throw ForbiddenError when GitHub App is not installed', async () => {
      const { findInstallationForRepo } = await import('../src/services/github-app.service');

      (findInstallationForRepo as any).mockResolvedValue(null);

      const { getUserRoleWithApp } = await import('../src/utils/github');

      await expect(getUserRoleWithApp('unknown/repo', 'user')).rejects.toThrow(
        'GitHub App not installed'
      );
    });
  });
});
