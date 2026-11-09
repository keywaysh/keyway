/**
 * VCS Base Provider
 *
 * Abstract base class for VCS providers.
 * Extend this class to implement support for a new forge (GitHub, GitLab, Bitbucket).
 */

import type {
  ForgeType,
  VcsProviderInterface,
  VcsUser,
  VcsRepository,
  VcsOrganization,
  VcsCollaborator,
  VcsOrgMember,
  TokenResponse,
  RoleMapper,
} from "./types";
import type { CollaboratorRole } from "../../db/schema";
import type { ForgeAccount } from "../../utils/forgeAccount";

/**
 * Abstract VCS Provider
 *
 * Provides common functionality and defines the interface that all
 * forge-specific providers must implement.
 */
export abstract class VcsProvider implements VcsProviderInterface {
  abstract readonly forgeType: ForgeType;
  abstract readonly roleMapper: RoleMapper;

  // ============================================================================
  // OAuth (Abstract - must be implemented by each provider)
  // ============================================================================

  /**
   * Get the OAuth authorization URL for this forge
   */
  abstract getAuthorizationUrl(state: string, redirectUri: string): string;

  /**
   * Exchange an OAuth code for an access token
   */
  abstract exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<TokenResponse>;

  // ============================================================================
  // User (Abstract - must be implemented by each provider)
  // ============================================================================

  /**
   * Get the authenticated user's profile
   */
  abstract getUser(accessToken: string): Promise<VcsUser>;

  /**
   * Get the authenticated user's email addresses
   */
  abstract getUserEmails(accessToken: string): Promise<string[]>;

  // ============================================================================
  // Repository (Abstract - must be implemented by each provider)
  // ============================================================================

  /**
   * Get repository information
   */
  abstract getRepository(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<VcsRepository | null>;

  /**
   * Get the account's role on a repository
   * Returns null if the account has no access. Bound to `account.forgeUserId`:
   * logins can be released and re-registered by someone else.
   */
  abstract getUserRole(
    accessToken: string,
    owner: string,
    repo: string,
    account: ForgeAccount
  ): Promise<CollaboratorRole | null>;

  /**
   * List all collaborators on a repository
   */
  abstract listCollaborators(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<VcsCollaborator[]>;

  // ============================================================================
  // Organization (Abstract - must be implemented by each provider)
  // ============================================================================

  /**
   * Get organization information
   */
  abstract getOrganization(accessToken: string, org: string): Promise<VcsOrganization | null>;

  /**
   * List all members of an organization
   */
  abstract listOrgMembers(accessToken: string, org: string): Promise<VcsOrgMember[]>;

  /**
   * Get an account's membership in an organization (null unless the forge's
   * answer is about `account.forgeUserId`)
   */
  abstract getOrgMembership(
    accessToken: string,
    org: string,
    account: ForgeAccount
  ): Promise<{ role: "owner" | "member"; state: string } | null>;

  // ============================================================================
  // Utility Methods (Concrete - shared by all providers)
  // ============================================================================

  /**
   * Check if a user has at least the required role level
   */
  hasRoleLevel(userRole: CollaboratorRole, requiredRole: CollaboratorRole): boolean {
    const userLevel = this.roleMapper.getRoleLevel(userRole);
    const requiredLevel = this.roleMapper.getRoleLevel(requiredRole);
    return userLevel >= requiredLevel;
  }

  /**
   * Check if user has read access to a repository
   */
  async hasReadAccess(
    accessToken: string,
    owner: string,
    repo: string,
    account: ForgeAccount
  ): Promise<boolean> {
    const role = await this.getUserRole(accessToken, owner, repo, account);
    return role !== null;
  }

  /**
   * Check if user has write access to a repository
   */
  async hasWriteAccess(
    accessToken: string,
    owner: string,
    repo: string,
    account: ForgeAccount
  ): Promise<boolean> {
    const role = await this.getUserRole(accessToken, owner, repo, account);
    if (!role) {
      return false;
    }
    return this.hasRoleLevel(role, "write");
  }

  /**
   * Check if user has admin access to a repository
   */
  async hasAdminAccess(
    accessToken: string,
    owner: string,
    repo: string,
    account: ForgeAccount
  ): Promise<boolean> {
    const role = await this.getUserRole(accessToken, owner, repo, account);
    if (!role) {
      return false;
    }
    return role === "admin";
  }

  /**
   * Parse a repository full name into owner and repo
   */
  parseRepoFullName(fullName: string): { owner: string; repo: string } {
    const parts = fullName.split("/");
    if (parts.length < 2) {
      throw new Error(`Invalid repository name: ${fullName}`);
    }
    // Handle GitLab-style paths like "group/subgroup/project"
    const repo = parts.pop()!;
    const owner = parts.join("/");
    return { owner, repo };
  }
}
