import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GitHubApiClient,
  GITHUB_ROLE_MAP,
  getCollaboratorRoleFromPermissions,
} from '../../src/services/vcs/github/github.api-client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitHubApiClient', () => {
  let client: GitHubApiClient;
  const accessToken = 'gho_test_token_123';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GitHubApiClient('https://api.github.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Role Mapping
  // ==========================================================================

  describe('GITHUB_ROLE_MAP', () => {
    it('should map GitHub roles to CollaboratorRole', () => {
      expect(GITHUB_ROLE_MAP['pull']).toBe('read');
      expect(GITHUB_ROLE_MAP['read']).toBe('read');
      expect(GITHUB_ROLE_MAP['triage']).toBe('triage');
      expect(GITHUB_ROLE_MAP['push']).toBe('write');
      expect(GITHUB_ROLE_MAP['write']).toBe('write');
      expect(GITHUB_ROLE_MAP['maintain']).toBe('maintain');
      expect(GITHUB_ROLE_MAP['admin']).toBe('admin');
    });
  });

  describe('getCollaboratorRoleFromPermissions', () => {
    it('should return admin for admin permission', () => {
      expect(getCollaboratorRoleFromPermissions({ admin: true })).toBe('admin');
    });

    it('should return maintain for maintain permission', () => {
      expect(getCollaboratorRoleFromPermissions({ maintain: true, push: true, pull: true })).toBe('maintain');
    });

    it('should return write for push permission', () => {
      expect(getCollaboratorRoleFromPermissions({ push: true, pull: true })).toBe('write');
    });

    it('should return triage for triage permission', () => {
      expect(getCollaboratorRoleFromPermissions({ triage: true, pull: true })).toBe('triage');
    });

    it('should return read for pull permission', () => {
      expect(getCollaboratorRoleFromPermissions({ pull: true })).toBe('read');
    });

    it('should return null for no permissions', () => {
      expect(getCollaboratorRoleFromPermissions({})).toBe(null);
    });

    it('should return null for undefined permissions', () => {
      expect(getCollaboratorRoleFromPermissions(undefined)).toBe(null);
    });

    it('should prioritize higher permissions', () => {
      // If user has both admin and push, should return admin
      expect(getCollaboratorRoleFromPermissions({ admin: true, push: true, pull: true })).toBe('admin');
    });
  });

  // ==========================================================================
  // User Methods
  // ==========================================================================

  describe('getUser', () => {
    it('should return user data on success', async () => {
      const mockUser = {
        id: 12345,
        login: 'testuser',
        email: 'test@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/12345',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const result = await client.getUser(accessToken);

      expect(result).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${accessToken}`,
          }),
        })
      );
    });

    it('should return null on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Bad credentials',
      });

      const result = await client.getUser(accessToken);

      expect(result).toBeNull();
    });
  });

  describe('getUserEmails', () => {
    it('should return list of emails', async () => {
      const mockEmails = [
        { email: 'primary@example.com', primary: true, verified: true },
        { email: 'secondary@example.com', primary: false, verified: true },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmails,
      });

      const result = await client.getUserEmails(accessToken);

      expect(result).toEqual(mockEmails);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      const result = await client.getUserEmails(accessToken);

      expect(result).toEqual([]);
    });
  });

  describe('getPrimaryEmail', () => {
    it('should return primary verified email', async () => {
      const mockEmails = [
        { email: 'secondary@example.com', primary: false, verified: true },
        { email: 'primary@example.com', primary: true, verified: true },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmails,
      });

      const result = await client.getPrimaryEmail(accessToken);

      expect(result).toBe('primary@example.com');
    });

    it('should fall back to first verified email', async () => {
      const mockEmails = [
        { email: 'verified@example.com', primary: false, verified: true },
        { email: 'unverified@example.com', primary: true, verified: false },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmails,
      });

      const result = await client.getPrimaryEmail(accessToken);

      expect(result).toBe('verified@example.com');
    });

    it('should return null when no emails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await client.getPrimaryEmail(accessToken);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Repository Methods
  // ==========================================================================

  describe('getRepository', () => {
    it('should return repository data', async () => {
      const mockRepo = {
        id: 123,
        name: 'test-repo',
        full_name: 'testuser/test-repo',
        private: false,
        default_branch: 'main',
        owner: { login: 'testuser', type: 'User' },
        permissions: { pull: true, push: true, admin: false },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      });

      const result = await client.getRepository(accessToken, 'testuser', 'test-repo');

      expect(result).toEqual(mockRepo);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testuser/test-repo',
        expect.any(Object)
      );
    });

    it('should return null for non-existent repo', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      const result = await client.getRepository(accessToken, 'testuser', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getUserPermission', () => {
    it('should return user permission data', async () => {
      const mockPermission = {
        permission: 'write',
        role_name: 'push',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPermission,
      });

      const result = await client.getUserPermission(accessToken, 'owner', 'repo', 'collaborator');

      expect(result).toEqual(mockPermission);
    });

    it('should return null for non-collaborator', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'User is not a collaborator',
      });

      const result = await client.getUserPermission(accessToken, 'owner', 'repo', 'stranger');

      expect(result).toBeNull();
    });
  });

  describe('getUserRole', () => {
    it('should return admin for repo owner', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'testuser', type: 'User' },
          permissions: { pull: true, push: true, admin: true },
        }),
      });

      const result = await client.getUserRole(accessToken, 'testuser', 'repo', 'testuser');

      expect(result).toBe('admin');
    });

    it('should return admin for user with admin permission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'other', type: 'User' },
          permissions: { admin: true },
        }),
      });

      const result = await client.getUserRole(accessToken, 'other', 'repo', 'testuser');

      expect(result).toBe('admin');
    });

    it('should return admin for org owner', async () => {
      // First call: getRepository
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'myorg', type: 'Organization' },
          permissions: { pull: true, push: true },
        }),
      });

      // Second call: getOrgMembership
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          role: 'admin',
          state: 'active',
        }),
      });

      const result = await client.getUserRole(accessToken, 'myorg', 'repo', 'orgadmin');

      expect(result).toBe('admin');
    });

    it('should return role from permission API', async () => {
      // First call: getRepository
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'other', type: 'User' },
          permissions: { pull: true },
        }),
      });

      // Second call: getUserPermission
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          role_name: 'push',
          permission: 'write',
        }),
      });

      const result = await client.getUserRole(accessToken, 'other', 'repo', 'collaborator');

      expect(result).toBe('write');
    });

    it('should fall back to repo permissions', async () => {
      // First call: getRepository
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'other', type: 'User' },
          permissions: { pull: true, push: true },
        }),
      });

      // Second call: getUserPermission fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      const result = await client.getUserRole(accessToken, 'other', 'repo', 'collaborator');

      expect(result).toBe('write');
    });

    it('should return null when repo not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      const result = await client.getUserRole(accessToken, 'owner', 'nonexistent', 'user');

      expect(result).toBeNull();
    });
  });

  describe('listCollaborators', () => {
    it('should return list of collaborators', async () => {
      const mockCollaborators = [
        { id: 1, login: 'user1', avatar_url: 'url1', html_url: 'html1', role_name: 'admin' },
        { id: 2, login: 'user2', avatar_url: 'url2', html_url: 'html2', role_name: 'push' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCollaborators,
      });

      const result = await client.listCollaborators(accessToken, 'owner', 'repo');

      expect(result).toEqual(mockCollaborators);
    });

    it('should handle pagination', async () => {
      const page1 = Array(100).fill(null).map((_, i) => ({
        id: i, login: `user${i}`, avatar_url: '', html_url: '', role_name: 'push',
      }));
      const page2 = [
        { id: 100, login: 'user100', avatar_url: '', html_url: '', role_name: 'push' },
      ];

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => page1 })
        .mockResolvedValueOnce({ ok: true, json: async () => page2 });

      const result = await client.listCollaborators(accessToken, 'owner', 'repo');

      expect(result).toHaveLength(101);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Forbidden',
      });

      const result = await client.listCollaborators(accessToken, 'owner', 'repo');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Organization Methods
  // ==========================================================================

  describe('getOrgMembership', () => {
    it('should return membership data', async () => {
      const mockMembership = {
        state: 'active',
        role: 'admin',
        organization: { id: 123, login: 'myorg', avatar_url: 'url' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMembership,
      });

      const result = await client.getOrgMembership(accessToken, 'myorg', 'testuser');

      expect(result).toEqual(mockMembership);
    });

    it('should return null for non-member', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not a member',
      });

      const result = await client.getOrgMembership(accessToken, 'myorg', 'stranger');

      expect(result).toBeNull();
    });
  });

  describe('listOrgMembers', () => {
    it('should return list of members', async () => {
      const mockMembers = [
        { id: 1, login: 'member1', avatar_url: 'url1' },
        { id: 2, login: 'member2', avatar_url: 'url2' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMembers,
      });

      const result = await client.listOrgMembers(accessToken, 'myorg');

      expect(result).toEqual(mockMembers);
    });

    it('should handle pagination for large orgs', async () => {
      const page1 = Array(100).fill(null).map((_, i) => ({
        id: i, login: `member${i}`, avatar_url: '',
      }));
      const page2 = [{ id: 100, login: 'member100', avatar_url: '' }];

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => page1 })
        .mockResolvedValueOnce({ ok: true, json: async () => page2 });

      const result = await client.listOrgMembers(accessToken, 'myorg');

      expect(result).toHaveLength(101);
    });
  });

  // ==========================================================================
  // OAuth Methods
  // ==========================================================================

  describe('exchangeCodeForToken', () => {
    it('should exchange code for access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'gho_new_token_123',
          token_type: 'bearer',
          scope: 'read:user,user:email',
        }),
      });

      const result = await GitHubApiClient.exchangeCodeForToken(
        'auth_code',
        'client_id',
        'client_secret'
      );

      expect(result).toBe('gho_new_token_123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            client_id: 'client_id',
            client_secret: 'client_secret',
            code: 'auth_code',
          }),
        })
      );
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(
        GitHubApiClient.exchangeCodeForToken('code', 'id', 'secret')
      ).rejects.toThrow('GitHub OAuth token exchange failed');
    });

    it('should throw on OAuth error in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
        }),
      });

      await expect(
        GitHubApiClient.exchangeCodeForToken('expired_code', 'id', 'secret')
      ).rejects.toThrow('GitHub OAuth error: The code passed is incorrect or expired.');
    });

    it('should throw when no access token received', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(
        GitHubApiClient.exchangeCodeForToken('code', 'id', 'secret')
      ).rejects.toThrow('No access token received from GitHub');
    });
  });
});
