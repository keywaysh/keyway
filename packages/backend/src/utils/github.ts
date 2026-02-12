import { config } from "../config";
import { ForbiddenError, UnauthorizedError } from "../lib";
import type { CollaboratorRole } from "../db/schema";
import { findInstallationForRepo, getInstallationToken } from "../services/github-app.service";
import { logger } from "./sharedLogger";
import { maskToken } from "./logger";

const GITHUB_API_BASE = config.github?.apiBaseUrl || "https://api.github.com";

/**
 * Token source type - always 'app' since we only use GitHub App tokens
 */
export type TokenSource = "app";

/**
 * Get the GitHub App installation token for accessing a repository.
 * GitHub App must be installed for the repository.
 *
 * @param repoOwner - Repository owner
 * @param repoName - Repository name
 * @returns Installation token
 * @throws ForbiddenError if GitHub App is not installed for this repo
 */
export async function getTokenForRepo(repoOwner: string, repoName: string): Promise<string> {
  const installation = await findInstallationForRepo(repoOwner, repoName);

  if (!installation) {
    throw new ForbiddenError(
      `GitHub App not installed for ${repoOwner}/${repoName}. ` +
        `Please install the Keyway GitHub App: ${config.githubApp.installUrl}`
    );
  }

  return getInstallationToken(installation.installationId);
}

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string | null;
}

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubRepo {
  private?: boolean;
  owner?: {
    login: string;
    type?: "User" | "Organization";
  };
  permissions?: {
    pull?: boolean;
    triage?: boolean;
    push?: boolean;
    maintain?: boolean;
    admin?: boolean;
  };
}

interface _GitHubCollaborator {
  role_name: "pull" | "triage" | "push" | "maintain" | "admin";
  permissions: {
    pull: boolean;
    push: boolean;
    admin: boolean;
  };
}

interface GitHubTokenErrorResponse {
  error?: string;
  error_description?: string;
  error_uri?: string;
}

/**
 * Exchange GitHub OAuth code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch(`${config.github.url}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub OAuth token exchange failed: ${response.statusText}`);
  }

  const data = (await response.json()) as GitHubTokenResponse & GitHubTokenErrorResponse;

  // GitHub returns 200 even on errors, with error details in the body
  if (data.error) {
    const errorMessage = data.error_description || data.error;
    throw new Error(`GitHub OAuth error: ${errorMessage} (${data.error})`);
  }

  if (!data.access_token) {
    throw new Error("No access token received from GitHub (unexpected empty response)");
  }

  return data.access_token;
}

/**
 * Fetch authenticated GitHub user info
 */
export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub user: ${response.statusText}`);
  }

  const data = (await response.json()) as GitHubUser;

  return data;
}

/**
 * Check if user has access to a repository (is collaborator or admin)
 */
export async function hasRepoAccess(accessToken: string, repoFullName: string): Promise<boolean> {
  const result = await getRepoAccessAndPermission(accessToken, repoFullName);
  return result.hasAccess;
}

/**
 * Get both access status and permission level in a single API call
 * Use this to avoid duplicate GitHub API calls
 */
export async function getRepoAccessAndPermission(
  accessToken: string,
  repoFullName: string
): Promise<{ hasAccess: boolean; permission: CollaboratorRole | null }> {
  const [owner, repo] = repoFullName.split("/");

  try {
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!repoResponse.ok) {
      const errorBody = await repoResponse.text();
      logger.error(
        {
          status: repoResponse.status,
          statusText: repoResponse.statusText,
          repoFullName,
          token: maskToken(accessToken),
          errorBody: errorBody.substring(0, 500),
        },
        "GitHub API error in getRepoAccessAndPermission"
      );
      return { hasAccess: false, permission: null };
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;
    const perms = repoData.permissions;

    if (!perms) {
      return { hasAccess: false, permission: null };
    }

    // Determine highest permission level
    let permission: CollaboratorRole | null = null;
    if (perms.admin) {
      permission = "admin";
    } else if (perms.maintain) {
      permission = "maintain";
    } else if (perms.push) {
      permission = "write";
    } else if (perms.triage) {
      permission = "triage";
    } else if (perms.pull) {
      permission = "read";
    }

    // Check if user has push access (collaborator or admin)
    const hasAccess = perms.push === true || perms.admin === true;

    return { hasAccess, permission };
  } catch {
    return { hasAccess: false, permission: null };
  }
}

/**
 * Check if user has admin access to a repository
 */
export async function hasAdminAccess(accessToken: string, repoFullName: string): Promise<boolean> {
  const [owner, repo] = repoFullName.split("/");

  const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!repoResponse.ok) {
    return false;
  }

  const repoData = (await repoResponse.json()) as GitHubRepo;

  // Only admin can initialize vaults
  return repoData.permissions?.admin === true;
}

/**
 * Get user's permission level for a repository
 * Returns the highest permission: admin > maintain > write > triage > read
 */
export async function getRepoPermission(
  accessToken: string,
  repoFullName: string
): Promise<CollaboratorRole | null> {
  const [owner, repo] = repoFullName.split("/");

  try {
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!repoResponse.ok) {
      return null;
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;
    const perms = repoData.permissions;

    if (!perms) {
      return null;
    }

    // Return highest permission level
    if (perms.admin) {
      return "admin";
    }
    if (perms.maintain) {
      return "maintain";
    }
    if (perms.push) {
      return "write";
    }
    if (perms.triage) {
      return "triage";
    }
    if (perms.pull) {
      return "read";
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get user's collaborator role for a repository
 * Returns one of: read, triage, write, maintain, admin
 */
export async function getUserRole(
  accessToken: string,
  repoFullName: string,
  username: string
): Promise<CollaboratorRole | null> {
  const [owner, repo] = repoFullName.split("/");
  logger.debug({ username, repoFullName }, "Getting GitHub user role");

  try {
    // First, get basic repo info and permissions
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!repoResponse.ok) {
      const errorBody = await repoResponse.text();
      logger.error(
        {
          status: repoResponse.status,
          errorBody: errorBody.substring(0, 200),
          username,
          repoFullName,
        },
        "Failed to get repo info"
      );
      return null;
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;
    logger.debug(
      {
        owner: repoData.owner?.login,
        type: repoData.owner?.type,
        permissions: repoData.permissions,
      },
      "GitHub repo data"
    );

    // Check if user is the repository owner (for personal repos)
    // Owners have admin access but don't appear in the collaborators list
    if (repoData.owner?.login === username) {
      logger.debug({ username, reason: "repo_owner" }, "User is repo owner, role=admin");
      return "admin";
    }

    // Also check if the repo owner (from URL) matches the username
    // This handles the case where installation tokens don't return full owner info
    if (owner === username) {
      logger.debug(
        { username, reason: "url_owner_match" },
        "User matches owner from URL, role=admin"
      );
      return "admin";
    }

    // If they have admin permission via the basic permissions check
    if (repoData.permissions?.admin === true) {
      logger.debug(
        { username, reason: "repo_api_admin" },
        "User has admin permission from repo API, role=admin"
      );
      return "admin";
    }

    // For organization repos, check if user is an org owner/admin
    if (repoData.owner?.type === "Organization") {
      try {
        const orgMembershipResponse = await fetch(
          `${GITHUB_API_BASE}/orgs/${owner}/memberships/${username}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          }
        );

        if (orgMembershipResponse.ok) {
          const membership = (await orgMembershipResponse.json()) as {
            role: string;
            state: string;
          };
          logger.debug(
            { username, org: owner, role: membership.role, state: membership.state },
            "Org membership check"
          );

          // Org owners have admin access to all repos in the org
          if (membership.role === "admin" && membership.state === "active") {
            logger.debug({ username, reason: "org_owner" }, "User is org owner, role=admin");
            return "admin";
          }
        } else {
          logger.debug({ status: orgMembershipResponse.status }, "Org membership check failed");
        }
      } catch (error) {
        logger.debug(
          { error: error instanceof Error ? error.message : "Unknown" },
          "Org membership check error"
        );
      }
    }

    // Try to get detailed collaborator role using the permission endpoint
    // This returns the actual permission level, not just 204/404
    const collabResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/collaborators/${username}/permission`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (collabResponse.ok) {
      const data = (await collabResponse.json()) as { permission: string; role_name: string };

      // Map GitHub's role_name to our CollaboratorRole type
      const roleMap: Record<string, CollaboratorRole> = {
        pull: "read",
        read: "read", // GitHub /permission endpoint can return 'read' directly
        triage: "triage",
        push: "write",
        write: "write", // GitHub /permission endpoint can return 'write' directly
        maintain: "maintain",
        admin: "admin",
      };

      // Use role_name for more accurate role, fallback to permission
      const role = roleMap[data.role_name] || roleMap[data.permission] || null;
      logger.debug(
        { roleName: data.role_name, permission: data.permission, role },
        "Got role from collaborator permission API"
      );
      return role;
    } else {
      const errorBody = await collabResponse.text();
      logger.debug(
        { status: collabResponse.status, body: errorBody.substring(0, 200) },
        "Collaborator permission API failed"
      );
    }

    // Fall back to basic permissions if collaborator API doesn't work
    if (repoData.permissions?.push === true) {
      logger.debug({ username, reason: "push_permission" }, "User has push permission, role=write");
      return "write";
    }
    if (repoData.permissions?.pull === true) {
      logger.debug({ username, reason: "pull_permission" }, "User has pull permission, role=read");
      return "read";
    }

    logger.warn({ username, repoFullName }, "No role found for user");
    return null;
  } catch (error) {
    // If API call fails or JSON parsing fails, return null
    // Caller handles null case appropriately
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", username, repoFullName },
      "Error getting user role"
    );
    return null;
  }
}

/**
 * Get GitHub user from access token
 */
export async function getUserFromToken(accessToken: string) {
  try {
    const user = await getGitHubUser(accessToken);

    // Get email - try /user/emails endpoint if email not in profile
    let email = user.email;
    if (!email) {
      try {
        const emailsResponse = await fetch(`${GITHUB_API_BASE}/user/emails`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (emailsResponse.ok) {
          const emails = (await emailsResponse.json()) as Array<{
            email: string;
            primary: boolean;
            verified: boolean;
          }>;
          // Get primary verified email, or first verified, or first email
          const primaryEmail = emails.find((e) => e.primary && e.verified);
          const verifiedEmail = emails.find((e) => e.verified);
          email = primaryEmail?.email || verifiedEmail?.email || emails[0]?.email || null;
        }
      } catch {
        // Ignore email fetch errors - email is optional
      }
    }

    return {
      forgeUserId: String(user.id), // Convert to string for multi-forge support
      username: user.login,
      email,
      avatarUrl: user.avatar_url,
    };
  } catch (_error) {
    throw new UnauthorizedError("Invalid or expired GitHub access token");
  }
}

/**
 * Get repository info including visibility (public/private) and ownership type
 * Returns null if repo doesn't exist or user doesn't have access
 */
export async function getRepoInfo(
  accessToken: string,
  repoFullName: string
): Promise<{ isPrivate: boolean; isOrganization: boolean } | null> {
  const [owner, repo] = repoFullName.split("/");

  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          repoFullName,
          token: maskToken(accessToken),
          errorBody: errorBody.substring(0, 500),
        },
        "GitHub API error in getRepoInfo"
      );
      return null;
    }

    const data = (await response.json()) as GitHubRepo;
    return {
      isPrivate: data.private === true,
      isOrganization: data.owner?.type === "Organization",
    };
  } catch {
    return null;
  }
}

/**
 * Collaborator info returned by the contributors endpoint
 */
export interface RepoCollaborator {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  permission: CollaboratorRole;
}

/**
 * GitHub API response for collaborators list
 */
interface GitHubCollaboratorListItem {
  login: string;
  avatar_url: string;
  html_url: string;
  role_name: "pull" | "triage" | "push" | "maintain" | "admin";
}

/**
 * Get all collaborators for a repository with their permission levels
 * Requires admin access to the repository
 */
export async function getRepoCollaborators(
  accessToken: string,
  owner: string,
  repo: string
): Promise<RepoCollaborator[]> {
  const collaborators: RepoCollaborator[] = [];
  let page = 1;
  const perPage = 100;

  // Map GitHub's role_name to our CollaboratorRole type
  const roleMap: Record<string, CollaboratorRole> = {
    pull: "read",
    read: "read", // GitHub can return 'read' directly
    triage: "triage",
    push: "write",
    write: "write", // GitHub can return 'write' directly
    maintain: "maintain",
    admin: "admin",
  };

  while (true) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/collaborators?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Admin access required to view collaborators");
      }
      throw new Error(`Failed to fetch collaborators: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubCollaboratorListItem[];

    for (const collab of data) {
      collaborators.push({
        login: collab.login,
        avatarUrl: collab.avatar_url,
        htmlUrl: collab.html_url,
        permission: roleMap[collab.role_name] || "read",
      });
    }

    // Check if there are more pages
    if (data.length < perPage) {
      break;
    }

    page++;
  }

  return collaborators;
}

// ============================================================================
// GitHub App wrappers
// These functions use GitHub App installation tokens
// ============================================================================

/**
 * Get repository info using GitHub App installation token
 * @throws ForbiddenError if GitHub App is not installed
 */
export async function getRepoInfoWithApp(
  repoFullName: string
): Promise<{ isPrivate: boolean; isOrganization: boolean } | null> {
  const [owner, repo] = repoFullName.split("/");
  const token = await getTokenForRepo(owner, repo);

  return getRepoInfo(token, repoFullName);
}

/**
 * Get all collaborators using GitHub App installation token
 * @throws ForbiddenError if GitHub App is not installed
 */
export async function getRepoCollaboratorsWithApp(
  owner: string,
  repo: string
): Promise<RepoCollaborator[]> {
  const token = await getTokenForRepo(owner, repo);
  return getRepoCollaborators(token, owner, repo);
}

/**
 * Check admin access using GitHub App installation token
 * @throws ForbiddenError if GitHub App is not installed
 */
export async function hasAdminAccessWithApp(repoFullName: string): Promise<boolean> {
  const [owner, repo] = repoFullName.split("/");
  const token = await getTokenForRepo(owner, repo);
  return hasAdminAccess(token, repoFullName);
}

/**
 * Get repo access and permission using GitHub App installation token
 * @throws ForbiddenError if GitHub App is not installed
 */
export async function getRepoAccessAndPermissionWithApp(
  repoFullName: string
): Promise<{ hasAccess: boolean; permission: CollaboratorRole | null }> {
  const [owner, repo] = repoFullName.split("/");
  const token = await getTokenForRepo(owner, repo);
  return getRepoAccessAndPermission(token, repoFullName);
}

/**
 * Get user role using GitHub App installation token
 * @throws ForbiddenError if GitHub App is not installed
 */
export async function getUserRoleWithApp(
  repoFullName: string,
  username: string
): Promise<CollaboratorRole | null> {
  logger.debug({ username, repoFullName }, "getUserRoleWithApp called");
  const [owner, repo] = repoFullName.split("/");
  try {
    const token = await getTokenForRepo(owner, repo);
    logger.debug({ repoFullName }, "Got installation token, checking user role");
    const role = await getUserRole(token, repoFullName, username);
    logger.debug({ username, repoFullName, role }, "getUserRoleWithApp result");
    return role;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", username, repoFullName },
      "getUserRoleWithApp failed"
    );
    throw error;
  }
}

// ============================================================================
// Organization Functions
// ============================================================================

export interface GitHubOrgMembershipInfo {
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
  role: "admin" | "member";
}

/**
 * Get a user's membership in a GitHub organization
 * Uses the user's access token to check their own membership
 */
export async function getOrgMembership(
  accessToken: string,
  org: string,
  username: string
): Promise<GitHubOrgMembershipInfo | null> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/orgs/${org}/memberships/${username}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      logger.warn({ org, username, status: response.status }, "Failed to get org membership");
      return null;
    }

    const data = (await response.json()) as {
      state: "active" | "pending";
      role: "admin" | "member";
      organization: { id: number; login: string; avatar_url: string };
    };
    return {
      state: data.state,
      role: data.role,
      organization: {
        id: data.organization.id,
        login: data.organization.login,
        avatar_url: data.organization.avatar_url,
      },
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", org, username },
      "Error getting org membership"
    );
    return null;
  }
}

/**
 * List all members of a GitHub organization with a specific role
 * Uses the role filter parameter to avoid needing admin permissions
 */
async function listOrgMembersByRole(
  accessToken: string,
  org: string,
  role: "admin" | "member"
): Promise<Array<{ id: number; login: string; avatar_url: string }>> {
  const members: Array<{ id: number; login: string; avatar_url: string }> = [];
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const response = await fetch(
        `${GITHUB_API_BASE}/orgs/${org}/members?role=${role}&per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        logger.warn(
          { org, role, status: response.status, error: errorBody.substring(0, 500) },
          "Failed to list org members by role"
        );
        break;
      }

      const data = (await response.json()) as Array<{
        id: number;
        login: string;
        avatar_url: string;
      }>;
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      members.push(...data);

      if (data.length < perPage) {
        break;
      }
      page++;
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", org, role },
      "Error listing org members by role"
    );
  }

  return members;
}

/**
 * List all members of a GitHub organization
 * Fetches admins and members separately using the role filter
 */
export async function listOrgMembers(accessToken: string, org: string): Promise<GitHubOrgMember[]> {
  // Fetch admins and members in parallel
  const [admins, regularMembers] = await Promise.all([
    listOrgMembersByRole(accessToken, org, "admin"),
    listOrgMembersByRole(accessToken, org, "member"),
  ]);

  const members: GitHubOrgMember[] = [];

  // Add admins with 'admin' role
  for (const admin of admins) {
    members.push({
      id: admin.id,
      login: admin.login,
      avatar_url: admin.avatar_url,
      role: "admin",
    });
  }

  // Add regular members with 'member' role
  for (const member of regularMembers) {
    members.push({
      id: member.id,
      login: member.login,
      avatar_url: member.avatar_url,
      role: "member",
    });
  }

  logger.info(
    { org, adminCount: admins.length, memberCount: regularMembers.length },
    "Listed org members"
  );

  return members;
}

/**
 * List all members of a GitHub organization using GitHub App token
 * Used when syncing org members from webhook events
 */
export async function listOrgMembersWithApp(
  installationId: number,
  org: string
): Promise<GitHubOrgMember[]> {
  try {
    const token = await getInstallationToken(installationId);
    return listOrgMembers(token, org);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", org, installationId },
      "Error listing org members with app"
    );
    return [];
  }
}

// ============================================================================
// GitHub Organization Info Functions
// ============================================================================

export interface GitHubOrgInfo {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  type: "Organization";
}

export interface GitHubUserOrg {
  id: number;
  login: string;
  avatar_url: string;
  description: string | null;
  role: "admin" | "member";
}

/**
 * List organizations where the GitHub App is installed and the user has access.
 * Uses /user/installations endpoint which works with GitHub App tokens.
 *
 * Note: This only returns orgs where the app is installed, not ALL orgs the user belongs to.
 * This is a limitation of GitHub Apps vs OAuth Apps.
 */
export async function listUserOrganizations(accessToken: string): Promise<GitHubUserOrg[]> {
  const orgs: GitHubUserOrg[] = [];
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const response = await fetch(
        `${GITHUB_API_BASE}/user/installations?per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        logger.warn(
          { status: response.status, body: errorBody, tokenPreview: maskToken(accessToken) },
          "Failed to list user installations"
        );
        break;
      }

      const data = (await response.json()) as {
        total_count: number;
        installations: Array<{
          id: number;
          account: {
            id: number;
            login: string;
            avatar_url: string;
            type: "User" | "Organization";
          };
          repository_selection: "all" | "selected";
        }>;
      };

      logger.info(
        { installationCount: data.installations?.length ?? 0, totalCount: data.total_count, page },
        "Fetched user installations from GitHub"
      );

      if (!data.installations || data.installations.length === 0) {
        break;
      }

      // Filter to only organizations (not user accounts)
      const orgInstallations = data.installations.filter(
        (inst) => inst.account.type === "Organization"
      );

      // Get user's role in each org - fetch all memberships in parallel
      const memberships = await Promise.all(
        orgInstallations.map((inst) =>
          getOrgMembershipForCurrentUser(accessToken, inst.account.login)
        )
      );

      for (let i = 0; i < orgInstallations.length; i++) {
        const inst = orgInstallations[i];
        const membership = memberships[i];
        orgs.push({
          id: inst.account.id,
          login: inst.account.login,
          avatar_url: inst.account.avatar_url,
          description: null, // installations endpoint doesn't include description
          role: membership?.role ?? "member",
        });
      }

      if (data.installations.length < perPage) {
        break;
      }
      page++;
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Error listing user installations"
    );
  }

  return orgs;
}

/**
 * Get the current user's membership in an organization
 * Uses /user/memberships/orgs/:org which works with the user's own token
 */
export async function getOrgMembershipForCurrentUser(
  accessToken: string,
  org: string
): Promise<{ role: "admin" | "member"; state: "active" | "pending" } | null> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/user/memberships/orgs/${org}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      role: "admin" | "member";
      state: "active" | "pending";
    };

    return { role: data.role, state: data.state };
  } catch {
    return null;
  }
}

/**
 * Get organization info from GitHub API using installation token
 * Returns null if org doesn't exist or is not accessible
 */
export async function getGitHubOrgInfo(orgLogin: string): Promise<GitHubOrgInfo | null> {
  try {
    // We need to find an installation that has access to this org
    // Use the org's own installation if available
    const installation = await findInstallationForRepo(orgLogin, "");
    if (!installation) {
      logger.debug({ orgLogin }, "No installation found for org");
      return null;
    }

    const token = await getInstallationToken(installation.installationId);

    const response = await fetch(`${GITHUB_API_BASE}/orgs/${orgLogin}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.debug({ orgLogin }, "GitHub org not found");
        return null;
      }
      logger.warn({ orgLogin, status: response.status }, "Failed to get org info from GitHub");
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
      type: "Organization" | "User";
    };

    // Verify it's actually an organization
    if (data.type !== "Organization") {
      logger.debug({ orgLogin, type: data.type }, "Not an organization");
      return null;
    }

    return {
      id: data.id,
      login: data.login,
      name: data.name,
      avatar_url: data.avatar_url,
      type: "Organization",
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", orgLogin },
      "Error getting GitHub org info"
    );
    return null;
  }
}

/**
 * Get organization info using a specific installation token
 * Used when we already have the installation from the repo
 */
export async function getGitHubOrgInfoWithToken(
  token: string,
  orgLogin: string
): Promise<GitHubOrgInfo | null> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/orgs/${orgLogin}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      logger.warn({ orgLogin, status: response.status }, "Failed to get org info from GitHub");
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
      type: "Organization" | "User";
    };

    if (data.type !== "Organization") {
      return null;
    }

    return {
      id: data.id,
      login: data.login,
      name: data.name,
      avatar_url: data.avatar_url,
      type: "Organization",
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", orgLogin },
      "Error getting GitHub org info with token"
    );
    return null;
  }
}
