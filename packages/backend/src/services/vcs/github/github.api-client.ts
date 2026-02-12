/**
 * GitHub API Client
 *
 * Centralized client for all GitHub API interactions.
 * This is extracted from src/utils/github.ts and will be used by GitHubProvider.
 */

import { config } from "../../../config";
import { logger } from "../../../utils/sharedLogger";
import { maskToken } from "../../../utils/logger";
import type { CollaboratorRole } from "../../../db/schema";

const GITHUB_API_BASE = config.github?.apiBaseUrl || "https://api.github.com";

// ============================================================================
// API Response Types
// ============================================================================

export interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string | null;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch?: string;
  owner: {
    login: string;
    type: "User" | "Organization";
  };
  permissions?: {
    pull?: boolean;
    triage?: boolean;
    push?: boolean;
    maintain?: boolean;
    admin?: boolean;
  };
}

export interface GitHubCollaborator {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  role_name: "pull" | "triage" | "push" | "maintain" | "admin";
}

export interface GitHubOrgMembership {
  state: "active" | "pending";
  role: "admin" | "member";
  organization: {
    id: number;
    login: string;
    avatar_url: string;
  };
}

export interface GitHubOrgMember {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubTokenErrorResponse {
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export interface GitHubPermissionResponse {
  permission: string;
  role_name: string;
}

// ============================================================================
// Role Mapping
// ============================================================================

/**
 * Map GitHub's role_name to our CollaboratorRole type
 */
export const GITHUB_ROLE_MAP: Record<string, CollaboratorRole> = {
  pull: "read",
  read: "read",
  triage: "triage",
  push: "write",
  write: "write",
  maintain: "maintain",
  admin: "admin",
};

/**
 * Get CollaboratorRole from GitHub permissions object
 */
export function getCollaboratorRoleFromPermissions(
  permissions: GitHubRepo["permissions"]
): CollaboratorRole | null {
  if (!permissions) {
    return null;
  }
  if (permissions.admin) {
    return "admin";
  }
  if (permissions.maintain) {
    return "maintain";
  }
  if (permissions.push) {
    return "write";
  }
  if (permissions.triage) {
    return "triage";
  }
  if (permissions.pull) {
    return "read";
  }
  return null;
}

// ============================================================================
// GitHub API Client
// ============================================================================

/**
 * GitHub API Client
 *
 * Provides typed methods for interacting with the GitHub API.
 * All methods require an access token (either user token or installation token).
 */
export class GitHubApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = GITHUB_API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an authenticated request to the GitHub API
   */
  private async request<T>(
    path: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.debug(
        {
          status: response.status,
          statusText: response.statusText,
          path,
          errorBody: errorBody.substring(0, 500),
          token: maskToken(accessToken),
        },
        "GitHub API request failed"
      );
      return null;
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // User Methods
  // ============================================================================

  /**
   * Get the authenticated user's profile
   */
  async getUser(accessToken: string): Promise<GitHubUser | null> {
    return this.request<GitHubUser>("/user", accessToken);
  }

  /**
   * Get the authenticated user's email addresses
   */
  async getUserEmails(accessToken: string): Promise<GitHubEmail[]> {
    const emails = await this.request<GitHubEmail[]>("/user/emails", accessToken);
    return emails || [];
  }

  /**
   * Get primary verified email from user's emails
   */
  async getPrimaryEmail(accessToken: string): Promise<string | null> {
    const emails = await this.getUserEmails(accessToken);
    if (emails.length === 0) {
      return null;
    }

    const primaryEmail = emails.find((e) => e.primary && e.verified);
    const verifiedEmail = emails.find((e) => e.verified);
    return primaryEmail?.email || verifiedEmail?.email || emails[0]?.email || null;
  }

  // ============================================================================
  // Repository Methods
  // ============================================================================

  /**
   * Get repository information
   */
  async getRepository(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepo | null> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`, accessToken);
  }

  /**
   * Get user's permission level on a repository
   */
  async getUserPermission(
    accessToken: string,
    owner: string,
    repo: string,
    username: string
  ): Promise<GitHubPermissionResponse | null> {
    return this.request<GitHubPermissionResponse>(
      `/repos/${owner}/${repo}/collaborators/${username}/permission`,
      accessToken
    );
  }

  /**
   * Get user's role on a repository
   * Checks multiple sources: repo owner, org membership, collaborator permission
   */
  async getUserRole(
    accessToken: string,
    owner: string,
    repo: string,
    username: string
  ): Promise<CollaboratorRole | null> {
    logger.debug({ username, owner, repo }, "Getting GitHub user role");

    // First, get basic repo info
    const repoData = await this.getRepository(accessToken, owner, repo);
    if (!repoData) {
      logger.debug({ owner, repo }, "Repository not found or no access");
      return null;
    }

    // Check if user is the repository owner
    if (repoData.owner.login === username || owner === username) {
      logger.debug({ username, reason: "repo_owner" }, "User is repo owner");
      return "admin";
    }

    // Check admin permission from repo API
    if (repoData.permissions?.admin) {
      logger.debug({ username, reason: "repo_api_admin" }, "User has admin permission");
      return "admin";
    }

    // For org repos, check org membership
    if (repoData.owner.type === "Organization") {
      const membership = await this.getOrgMembership(accessToken, owner, username);
      if (membership?.role === "admin" && membership?.state === "active") {
        logger.debug({ username, reason: "org_owner" }, "User is org owner");
        return "admin";
      }
    }

    // Try to get detailed collaborator role
    const permission = await this.getUserPermission(accessToken, owner, repo, username);
    if (permission) {
      const role = GITHUB_ROLE_MAP[permission.role_name] || GITHUB_ROLE_MAP[permission.permission];
      if (role) {
        logger.debug(
          { username, roleName: permission.role_name, role },
          "Got role from permission API"
        );
        return role;
      }
    }

    // Fall back to basic permissions
    const role = getCollaboratorRoleFromPermissions(repoData.permissions);
    if (role) {
      logger.debug(
        { username, role, reason: "fallback_permissions" },
        "Got role from repo permissions"
      );
      return role;
    }

    logger.warn({ username, owner, repo }, "No role found for user");
    return null;
  }

  /**
   * List all collaborators on a repository
   */
  async listCollaborators(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<GitHubCollaborator[]> {
    const collaborators: GitHubCollaborator[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const data = await this.request<GitHubCollaborator[]>(
        `/repos/${owner}/${repo}/collaborators?per_page=${perPage}&page=${page}`,
        accessToken
      );

      if (!data || data.length === 0) {
        break;
      }

      collaborators.push(...data);

      if (data.length < perPage) {
        break;
      }
      page++;
    }

    return collaborators;
  }

  // ============================================================================
  // Organization Methods
  // ============================================================================

  /**
   * Get a user's membership in an organization
   */
  async getOrgMembership(
    accessToken: string,
    org: string,
    username: string
  ): Promise<GitHubOrgMembership | null> {
    return this.request<GitHubOrgMembership>(`/orgs/${org}/memberships/${username}`, accessToken);
  }

  /**
   * List all members of an organization
   */
  async listOrgMembers(accessToken: string, org: string): Promise<GitHubOrgMember[]> {
    const members: GitHubOrgMember[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const data = await this.request<GitHubOrgMember[]>(
        `/orgs/${org}/members?per_page=${perPage}&page=${page}`,
        accessToken
      );

      if (!data || data.length === 0) {
        break;
      }

      members.push(...data);

      if (data.length < perPage) {
        break;
      }
      page++;
    }

    return members;
  }

  // ============================================================================
  // OAuth Methods (Static - don't require instance)
  // ============================================================================

  /**
   * Exchange OAuth code for access token
   */
  static async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<string> {
    const response = await fetch(`${config.github.url}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub OAuth token exchange failed: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubTokenResponse & GitHubTokenErrorResponse;

    // GitHub returns 200 even on errors
    if (data.error) {
      const errorMessage = data.error_description || data.error;
      throw new Error(`GitHub OAuth error: ${errorMessage} (${data.error})`);
    }

    if (!data.access_token) {
      throw new Error("No access token received from GitHub");
    }

    return data.access_token;
  }
}

// Export singleton instance for convenience
export const githubApiClient = new GitHubApiClient();
