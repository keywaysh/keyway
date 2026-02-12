/**
 * VCS Provider Types
 *
 * Common types and interfaces for multi-forge support.
 * This abstraction allows Keyway to work with GitHub, GitLab, Bitbucket, etc.
 */

import type { CollaboratorRole } from "../../db/schema";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Supported forge types
 */
export type ForgeType = "github" | "gitlab" | "bitbucket";

/**
 * Normalized role that all forges map to
 * Simplified to 4 levels for cross-forge compatibility
 */
export type NormalizedRole = "none" | "read" | "write" | "admin";

// ============================================================================
// User Types
// ============================================================================

/**
 * Forge-agnostic user representation
 */
export interface VcsUser {
  forgeType: ForgeType;
  forgeUserId: string; // ID as string for all forges (GitHub uses numbers, others use strings)
  username: string;
  email: string | null;
  avatarUrl: string | null;
}

// ============================================================================
// Repository Types
// ============================================================================

/**
 * Forge-agnostic repository representation
 */
export interface VcsRepository {
  forgeType: ForgeType;
  owner: string;
  name: string;
  fullName: string; // "owner/repo" format (universal across forges)
  isPrivate: boolean;
  defaultBranch?: string;
}

/**
 * Repository collaborator with their role
 */
export interface VcsCollaborator {
  forgeUserId: string;
  username: string;
  avatarUrl: string | null;
  forgeRole: string; // Native role from the forge (e.g., "push", "Developer")
  normalizedRole: NormalizedRole; // Mapped to our internal model
}

// ============================================================================
// Organization Types
// ============================================================================

/**
 * Forge-agnostic organization representation
 */
export interface VcsOrganization {
  forgeType: ForgeType;
  forgeOrgId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Organization member with their role
 */
export interface VcsOrgMember {
  forgeUserId: string;
  username: string;
  avatarUrl: string | null;
  role: "owner" | "member"; // Simplified to owner/member for all forges
  state: string; // Membership state (e.g., "active", "pending")
}

// ============================================================================
// OAuth Types
// ============================================================================

/**
 * OAuth token response from forge
 */
export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  scope?: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * OAuth configuration for a forge
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
}

// ============================================================================
// App Installation Types (GitHub App, GitLab integrations, etc.)
// ============================================================================

/**
 * VCS App installation (GitHub App, GitLab integration, etc.)
 */
export interface VcsAppInstallation {
  forgeType: ForgeType;
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  permissions: Record<string, string>;
  repositorySelection: "all" | "selected";
}

// ============================================================================
// Role Mapping
// ============================================================================

/**
 * Maps a forge-specific role to our internal CollaboratorRole
 */
export interface RoleMapper {
  forgeType: ForgeType;

  /**
   * Map forge role to Keyway's 5-level CollaboratorRole
   * Used for fine-grained permission checks
   */
  toCollaboratorRole(forgeRole: string): CollaboratorRole;

  /**
   * Map forge role to simplified 4-level NormalizedRole
   * Used for cross-forge compatibility
   */
  toNormalizedRole(forgeRole: string): NormalizedRole;

  /**
   * Get the hierarchy level of a role (higher = more permissions)
   */
  getRoleLevel(role: CollaboratorRole): number;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Abstract VCS Provider interface
 * Implement this for each forge (GitHub, GitLab, Bitbucket)
 */
export interface VcsProviderInterface {
  readonly forgeType: ForgeType;
  readonly roleMapper: RoleMapper;

  // OAuth
  getAuthorizationUrl(state: string, redirectUri: string): string;
  exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<TokenResponse>;

  // User
  getUser(accessToken: string): Promise<VcsUser>;
  getUserEmails(accessToken: string): Promise<string[]>;

  // Repository
  getRepository(accessToken: string, owner: string, repo: string): Promise<VcsRepository | null>;
  getUserRole(
    accessToken: string,
    owner: string,
    repo: string,
    username: string
  ): Promise<CollaboratorRole | null>;
  listCollaborators(accessToken: string, owner: string, repo: string): Promise<VcsCollaborator[]>;

  // Organization
  getOrganization(accessToken: string, org: string): Promise<VcsOrganization | null>;
  listOrgMembers(accessToken: string, org: string): Promise<VcsOrgMember[]>;
  getOrgMembership(
    accessToken: string,
    org: string,
    username: string
  ): Promise<{ role: "owner" | "member"; state: string } | null>;
}
