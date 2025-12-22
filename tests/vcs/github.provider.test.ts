import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubProvider, gitHubRoleMapper } from '../../src/services/vcs/github/github.provider';

// Mock the config
vi.mock('../../src/config', () => ({
  config: {
    github: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      apiBaseUrl: 'https://api.github.com',
    },
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitHubProvider', () => {
  let provider: GitHubProvider;
  const accessToken = 'gho_test_token_123';

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GitHubProvider('test-client-id', 'test-client-secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Provider Properties
  // ==========================================================================

  describe('properties', () => {
    it('should have forgeType "github"', () => {
      expect(provider.forgeType).toBe('github');
    });

    it('should have roleMapper', () => {
      expect(provider.roleMapper).toBe(gitHubRoleMapper);
    });
  });

  // ==========================================================================
  // Role Mapper
  // ==========================================================================

  describe('gitHubRoleMapper', () => {
    describe('toCollaboratorRole', () => {
      it('should map GitHub roles correctly', () => {
        expect(gitHubRoleMapper.toCollaboratorRole('pull')).toBe('read');
        expect(gitHubRoleMapper.toCollaboratorRole('triage')).toBe('triage');
        expect(gitHubRoleMapper.toCollaboratorRole('push')).toBe('write');
        expect(gitHubRoleMapper.toCollaboratorRole('maintain')).toBe('maintain');
        expect(gitHubRoleMapper.toCollaboratorRole('admin')).toBe('admin');
      });

      it('should handle case-insensitive roles', () => {
        expect(gitHubRoleMapper.toCollaboratorRole('ADMIN')).toBe('admin');
        expect(gitHubRoleMapper.toCollaboratorRole('Push')).toBe('write');
      });

      it('should default to read for unknown roles', () => {
        expect(gitHubRoleMapper.toCollaboratorRole('unknown')).toBe('read');
        expect(gitHubRoleMapper.toCollaboratorRole('')).toBe('read');
      });
    });

    describe('toNormalizedRole', () => {
      it('should map to normalized roles', () => {
        expect(gitHubRoleMapper.toNormalizedRole('pull')).toBe('read');
        expect(gitHubRoleMapper.toNormalizedRole('triage')).toBe('read');
        expect(gitHubRoleMapper.toNormalizedRole('push')).toBe('write');
        expect(gitHubRoleMapper.toNormalizedRole('maintain')).toBe('write');
        expect(gitHubRoleMapper.toNormalizedRole('admin')).toBe('admin');
      });

      it('should return none for unknown roles', () => {
        expect(gitHubRoleMapper.toNormalizedRole('unknown')).toBe('none');
      });
    });

    describe('getRoleLevel', () => {
      it('should return correct role levels', () => {
        expect(gitHubRoleMapper.getRoleLevel('read')).toBe(0);
        expect(gitHubRoleMapper.getRoleLevel('triage')).toBe(1);
        expect(gitHubRoleMapper.getRoleLevel('write')).toBe(2);
        expect(gitHubRoleMapper.getRoleLevel('maintain')).toBe(3);
        expect(gitHubRoleMapper.getRoleLevel('admin')).toBe(4);
      });

      it('should return -1 for unknown role', () => {
        expect(gitHubRoleMapper.getRoleLevel('unknown' as any)).toBe(-1);
      });
    });
  });

  // ==========================================================================
  // OAuth
  // ==========================================================================

  describe('getAuthorizationUrl', () => {
    it('should return correct OAuth URL', () => {
      const url = provider.getAuthorizationUrl('state123', 'https://example.com/callback');

      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('scope=read%3Auser+user%3Aemail');
      expect(url).toContain('state=state123');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should return token response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'gho_new_token',
          token_type: 'bearer',
          scope: 'read:user,user:email',
        }),
      });

      const result = await provider.exchangeCodeForToken('auth_code', 'https://example.com/callback');

      expect(result).toEqual({
        accessToken: 'gho_new_token',
        tokenType: 'bearer',
        scope: 'read:user,user:email',
      });
    });
  });

  // ==========================================================================
  // User
  // ==========================================================================

  describe('getUser', () => {
    it('should return VcsUser from GitHub user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          login: 'testuser',
          email: 'test@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/12345',
        }),
      });

      const result = await provider.getUser(accessToken);

      expect(result).toEqual({
        forgeType: 'github',
        forgeUserId: '12345',
        username: 'testuser',
        email: 'test@example.com',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
      });
    });

    it('should fetch email from emails endpoint if not in profile', async () => {
      // First call: getUser - no email
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          login: 'testuser',
          email: null,
          avatar_url: 'https://avatars.githubusercontent.com/u/12345',
        }),
      });

      // Second call: getUserEmails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { email: 'primary@example.com', primary: true, verified: true },
        ],
      });

      const result = await provider.getUser(accessToken);

      expect(result.email).toBe('primary@example.com');
    });

    it('should throw when user not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Bad credentials',
      });

      await expect(provider.getUser(accessToken)).rejects.toThrow('Failed to get GitHub user');
    });
  });

  describe('getUserEmails', () => {
    it('should return only verified emails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { email: 'verified@example.com', verified: true },
          { email: 'unverified@example.com', verified: false },
          { email: 'another@example.com', verified: true },
        ],
      });

      const result = await provider.getUserEmails(accessToken);

      expect(result).toEqual(['verified@example.com', 'another@example.com']);
    });
  });

  // ==========================================================================
  // Repository
  // ==========================================================================

  describe('getRepository', () => {
    it('should return VcsRepository', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          name: 'test-repo',
          full_name: 'testuser/test-repo',
          private: false,
          default_branch: 'main',
          owner: { login: 'testuser', type: 'User' },
        }),
      });

      const result = await provider.getRepository(accessToken, 'testuser', 'test-repo');

      expect(result).toEqual({
        forgeType: 'github',
        owner: 'testuser',
        name: 'test-repo',
        fullName: 'testuser/test-repo',
        isPrivate: false,
        defaultBranch: 'main',
      });
    });

    it('should return null for non-existent repo', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      const result = await provider.getRepository(accessToken, 'testuser', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getUserRole', () => {
    it('should delegate to client', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'testuser', type: 'User' },
          permissions: { admin: true },
        }),
      });

      const result = await provider.getUserRole(accessToken, 'testuser', 'repo', 'testuser');

      expect(result).toBe('admin');
    });
  });

  describe('listCollaborators', () => {
    it('should return VcsCollaborator array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, login: 'user1', avatar_url: 'url1', role_name: 'admin' },
          { id: 2, login: 'user2', avatar_url: 'url2', role_name: 'push' },
        ],
      });

      const result = await provider.listCollaborators(accessToken, 'owner', 'repo');

      expect(result).toEqual([
        {
          forgeUserId: '1',
          username: 'user1',
          avatarUrl: 'url1',
          forgeRole: 'admin',
          normalizedRole: 'admin',
        },
        {
          forgeUserId: '2',
          username: 'user2',
          avatarUrl: 'url2',
          forgeRole: 'push',
          normalizedRole: 'write',
        },
      ]);
    });
  });

  // ==========================================================================
  // Organization
  // ==========================================================================

  describe('getOrganization', () => {
    it('should return VcsOrganization for org owner', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'myorg', type: 'Organization' },
        }),
      });

      const result = await provider.getOrganization(accessToken, 'myorg');

      expect(result).toEqual({
        forgeType: 'github',
        forgeOrgId: 'myorg',
        login: 'myorg',
        displayName: null,
        avatarUrl: null,
      });
    });

    it('should return null for user (not org)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: 'testuser', type: 'User' },
        }),
      });

      const result = await provider.getOrganization(accessToken, 'testuser');

      expect(result).toBeNull();
    });

    it('should return null when repo not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      const result = await provider.getOrganization(accessToken, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listOrgMembers', () => {
    it('should return VcsOrgMember array with roles', async () => {
      // First call: listOrgMembers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, login: 'admin1', avatar_url: 'url1' },
          { id: 2, login: 'member1', avatar_url: 'url2' },
        ],
      });

      // Second call: getOrgMembership for admin1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'admin', state: 'active' }),
      });

      // Third call: getOrgMembership for member1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'member', state: 'active' }),
      });

      const result = await provider.listOrgMembers(accessToken, 'myorg');

      expect(result).toEqual([
        {
          forgeUserId: '1',
          username: 'admin1',
          avatarUrl: 'url1',
          role: 'owner',
          state: 'active',
        },
        {
          forgeUserId: '2',
          username: 'member1',
          avatarUrl: 'url2',
          role: 'member',
          state: 'active',
        },
      ]);
    });
  });

  describe('getOrgMembership', () => {
    it('should return membership with owner role for admin', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'admin', state: 'active' }),
      });

      const result = await provider.getOrgMembership(accessToken, 'myorg', 'adminuser');

      expect(result).toEqual({
        role: 'owner',
        state: 'active',
      });
    });

    it('should return membership with member role for non-admin', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'member', state: 'active' }),
      });

      const result = await provider.getOrgMembership(accessToken, 'myorg', 'memberuser');

      expect(result).toEqual({
        role: 'member',
        state: 'active',
      });
    });

    it('should return null for non-member', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not a member',
      });

      const result = await provider.getOrgMembership(accessToken, 'myorg', 'stranger');

      expect(result).toBeNull();
    });
  });
});
