/**
 * GitHub VCS Provider
 *
 * Implementation of VcsProvider for GitHub.
 * Handles OAuth, user/repo access, and organization management.
 */

import { VcsProvider } from '../base.provider';
import type {
  ForgeType,
  VcsUser,
  VcsRepository,
  VcsOrganization,
  VcsCollaborator,
  VcsOrgMember,
  TokenResponse,
  RoleMapper,
  NormalizedRole,
} from '../types';
import type { CollaboratorRole } from '../../../db/schema';
import {
  GitHubApiClient,
  GITHUB_ROLE_MAP,
  getCollaboratorRoleFromPermissions,
} from './github.api-client';
import { config } from '../../../config';

// ============================================================================
// GitHub Role Mapper
// ============================================================================

/**
 * Role hierarchy (from lowest to highest)
 */
const ROLE_HIERARCHY: CollaboratorRole[] = ['read', 'triage', 'write', 'maintain', 'admin'];

/**
 * GitHub-specific role mapper
 */
export const gitHubRoleMapper: RoleMapper = {
  forgeType: 'github',

  toCollaboratorRole(forgeRole: string): CollaboratorRole {
    return GITHUB_ROLE_MAP[forgeRole.toLowerCase()] || 'read';
  },

  toNormalizedRole(forgeRole: string): NormalizedRole {
    const role = GITHUB_ROLE_MAP[forgeRole.toLowerCase()];
    if (!role) return 'none';
    if (role === 'admin') return 'admin';
    if (role === 'write' || role === 'maintain') return 'write';
    return 'read';
  },

  getRoleLevel(role: CollaboratorRole): number {
    return ROLE_HIERARCHY.indexOf(role);
  },
};

// ============================================================================
// GitHub Provider
// ============================================================================

/**
 * GitHub VCS Provider
 *
 * Implements all VcsProvider methods for GitHub.
 */
export class GitHubProvider extends VcsProvider {
  readonly forgeType: ForgeType = 'github';
  readonly roleMapper: RoleMapper = gitHubRoleMapper;

  private client: GitHubApiClient;
  private clientId: string;
  private clientSecret: string;

  constructor(clientId?: string, clientSecret?: string) {
    super();
    this.client = new GitHubApiClient();
    this.clientId = clientId || config.github.clientId;
    this.clientSecret = clientSecret || config.github.clientSecret;
  }

  // ============================================================================
  // OAuth
  // ============================================================================

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email read:org',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(
    code: string,
    _redirectUri: string,
    _codeVerifier?: string
  ): Promise<TokenResponse> {
    const accessToken = await GitHubApiClient.exchangeCodeForToken(
      code,
      this.clientId,
      this.clientSecret
    );

    return {
      accessToken,
      tokenType: 'bearer',
      scope: 'read:user,user:email,read:org',
    };
  }

  // ============================================================================
  // User
  // ============================================================================

  async getUser(accessToken: string): Promise<VcsUser> {
    const user = await this.client.getUser(accessToken);
    if (!user) {
      throw new Error('Failed to get GitHub user');
    }

    // Get email if not in profile
    let email = user.email;
    if (!email) {
      email = await this.client.getPrimaryEmail(accessToken);
    }

    return {
      forgeType: 'github',
      forgeUserId: String(user.id),
      username: user.login,
      email,
      avatarUrl: user.avatar_url,
    };
  }

  async getUserEmails(accessToken: string): Promise<string[]> {
    const emails = await this.client.getUserEmails(accessToken);
    return emails.filter(e => e.verified).map(e => e.email);
  }

  // ============================================================================
  // Repository
  // ============================================================================

  async getRepository(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<VcsRepository | null> {
    const repoData = await this.client.getRepository(accessToken, owner, repo);
    if (!repoData) return null;

    return {
      forgeType: 'github',
      owner: repoData.owner.login,
      name: repoData.name,
      fullName: repoData.full_name,
      isPrivate: repoData.private,
      defaultBranch: repoData.default_branch,
    };
  }

  async getUserRole(
    accessToken: string,
    owner: string,
    repo: string,
    username: string
  ): Promise<CollaboratorRole | null> {
    return this.client.getUserRole(accessToken, owner, repo, username);
  }

  async listCollaborators(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<VcsCollaborator[]> {
    const collaborators = await this.client.listCollaborators(accessToken, owner, repo);

    return collaborators.map(collab => ({
      forgeUserId: String(collab.id),
      username: collab.login,
      avatarUrl: collab.avatar_url,
      forgeRole: collab.role_name,
      normalizedRole: this.roleMapper.toNormalizedRole(collab.role_name),
    }));
  }

  // ============================================================================
  // Organization
  // ============================================================================

  async getOrganization(
    accessToken: string,
    org: string
  ): Promise<VcsOrganization | null> {
    // For GitHub, we use the org membership endpoint to get org info
    // since we need to verify the user has access
    const repoData = await this.client.getRepository(accessToken, org, org);
    if (!repoData) {
      // Try to get org info through a different endpoint
      // GitHub doesn't have a direct "get org" endpoint for non-members
      return null;
    }

    if (repoData.owner.type !== 'Organization') {
      return null;
    }

    return {
      forgeType: 'github',
      forgeOrgId: String(repoData.owner.login), // GitHub orgs use login as ID
      login: repoData.owner.login,
      displayName: null, // Would need another API call
      avatarUrl: null, // Would need another API call
    };
  }

  async listOrgMembers(accessToken: string, org: string): Promise<VcsOrgMember[]> {
    const members = await this.client.listOrgMembers(accessToken, org);
    const result: VcsOrgMember[] = [];

    // Get each member's role
    for (const member of members) {
      const membership = await this.client.getOrgMembership(accessToken, org, member.login);
      result.push({
        forgeUserId: String(member.id),
        username: member.login,
        avatarUrl: member.avatar_url,
        role: membership?.role === 'admin' ? 'owner' : 'member',
        state: membership?.state || 'active',
      });
    }

    return result;
  }

  async getOrgMembership(
    accessToken: string,
    org: string,
    username: string
  ): Promise<{ role: 'owner' | 'member'; state: string } | null> {
    const membership = await this.client.getOrgMembership(accessToken, org, username);
    if (!membership) return null;

    return {
      role: membership.role === 'admin' ? 'owner' : 'member',
      state: membership.state,
    };
  }
}

// Export singleton instance
export const gitHubProvider = new GitHubProvider();
