import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRepoCollaborators } from '../src/utils/github';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
});
