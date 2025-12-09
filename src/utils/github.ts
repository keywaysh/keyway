import { z } from 'zod';
import { config } from '../config';
import { ForbiddenError, UnauthorizedError } from '../lib';
import type { CollaboratorRole } from '../db/schema';
import {
  findInstallationForRepo,
  getInstallationToken,
} from '../services/github-app.service';

const GITHUB_API_BASE = config.github.apiBaseUrl;

/**
 * Token source type - always 'app' since we only use GitHub App tokens
 */
export type TokenSource = 'app';

/**
 * Get the GitHub App installation token for accessing a repository.
 * GitHub App must be installed for the repository.
 *
 * @param repoOwner - Repository owner
 * @param repoName - Repository name
 * @returns Installation token
 * @throws ForbiddenError if GitHub App is not installed for this repo
 */
export async function getTokenForRepo(
  repoOwner: string,
  repoName: string
): Promise<string> {
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
    type?: 'User' | 'Organization';
  };
  permissions?: {
    pull?: boolean;
    triage?: boolean;
    push?: boolean;
    maintain?: boolean;
    admin?: boolean;
  };
}

interface GitHubCollaborator {
  role_name: 'pull' | 'triage' | 'push' | 'maintain' | 'admin';
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
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
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
    throw new Error('No access token received from GitHub (unexpected empty response)');
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
      Accept: 'application/vnd.github.v3+json',
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
export async function hasRepoAccess(
  accessToken: string,
  repoFullName: string
): Promise<boolean> {
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
  const [owner, repo] = repoFullName.split('/');

  try {
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!repoResponse.ok) {
      const errorBody = await repoResponse.text();
      console.error('[getRepoAccessAndPermission] GitHub API error:', {
        status: repoResponse.status,
        statusText: repoResponse.statusText,
        repoFullName,
        tokenPrefix: accessToken?.substring(0, 10),
        errorBody: errorBody.substring(0, 500),
      });
      return { hasAccess: false, permission: null };
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;
    const perms = repoData.permissions;

    if (!perms) {
      return { hasAccess: false, permission: null };
    }

    // Determine highest permission level
    let permission: CollaboratorRole | null = null;
    if (perms.admin) permission = 'admin';
    else if (perms.maintain) permission = 'maintain';
    else if (perms.push) permission = 'write';
    else if (perms.triage) permission = 'triage';
    else if (perms.pull) permission = 'read';

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
export async function hasAdminAccess(
  accessToken: string,
  repoFullName: string
): Promise<boolean> {
  const [owner, repo] = repoFullName.split('/');

  const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!repoResponse.ok) {
    return false;
  }

  const repoData = await repoResponse.json() as GitHubRepo;

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
  const [owner, repo] = repoFullName.split('/');

  try {
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
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
    if (perms.admin) return 'admin';
    if (perms.maintain) return 'maintain';
    if (perms.push) return 'write';
    if (perms.triage) return 'triage';
    if (perms.pull) return 'read';

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
  const [owner, repo] = repoFullName.split('/');
  console.log(`[GitHub] Getting role for user '${username}' on repo '${repoFullName}'`);

  try {
    // First, get basic repo info and permissions
    const repoResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!repoResponse.ok) {
      const errorBody = await repoResponse.text();
      console.error(`[GitHub] Failed to get repo info: status=${repoResponse.status}, error=${errorBody.substring(0, 200)}`);
      return null;
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;
    console.log(`[GitHub] Repo data: owner=${repoData.owner?.login}, type=${repoData.owner?.type}, permissions=${JSON.stringify(repoData.permissions)}`);

    // Check if user is the repository owner (for personal repos)
    // Owners have admin access but don't appear in the collaborators list
    if (repoData.owner?.login === username) {
      console.log(`[GitHub] User '${username}' is repo owner -> role=admin`);
      return 'admin';
    }

    // Also check if the repo owner (from URL) matches the username
    // This handles the case where installation tokens don't return full owner info
    if (owner === username) {
      console.log(`[GitHub] User '${username}' matches owner from URL -> role=admin`);
      return 'admin';
    }

    // If they have admin permission via the basic permissions check
    if (repoData.permissions?.admin === true) {
      console.log(`[GitHub] User '${username}' has admin permission from repo API -> role=admin`);
      return 'admin';
    }

    // For organization repos, check if user is an org owner/admin
    if (repoData.owner?.type === 'Organization') {
      try {
        const orgMembershipResponse = await fetch(
          `${GITHUB_API_BASE}/orgs/${owner}/memberships/${username}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        if (orgMembershipResponse.ok) {
          const membership = (await orgMembershipResponse.json()) as { role: string; state: string };
          console.log(`[GitHub] Org membership: user='${username}', org='${owner}', role=${membership.role}, state=${membership.state}`);

          // Org owners have admin access to all repos in the org
          if (membership.role === 'admin' && membership.state === 'active') {
            console.log(`[GitHub] User '${username}' is org owner -> role=admin`);
            return 'admin';
          }
        } else {
          console.log(`[GitHub] Org membership check failed: status=${orgMembershipResponse.status}`);
        }
      } catch (error) {
        console.log(`[GitHub] Org membership check error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // Try to get detailed collaborator role using the permission endpoint
    // This returns the actual permission level, not just 204/404
    const collabResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/collaborators/${username}/permission`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (collabResponse.ok) {
      const data = (await collabResponse.json()) as { permission: string; role_name: string };

      // Map GitHub's role_name to our CollaboratorRole type
      const roleMap: Record<string, CollaboratorRole> = {
        pull: 'read',
        read: 'read', // GitHub /permission endpoint can return 'read' directly
        triage: 'triage',
        push: 'write',
        write: 'write', // GitHub /permission endpoint can return 'write' directly
        maintain: 'maintain',
        admin: 'admin',
      };

      // Use role_name for more accurate role, fallback to permission
      const role = roleMap[data.role_name] || roleMap[data.permission] || null;
      console.log(`[GitHub] Got role from collaborator permission API: role_name=${data.role_name}, permission=${data.permission} -> role=${role}`);
      return role;
    } else {
      const errorBody = await collabResponse.text();
      console.log(`[GitHub] Collaborator permission API failed: status=${collabResponse.status}, body=${errorBody.substring(0, 200)}`);
    }

    // Fall back to basic permissions if collaborator API doesn't work
    if (repoData.permissions?.push === true) {
      console.log(`[GitHub] User has push permission -> role=write`);
      return 'write';
    }
    if (repoData.permissions?.pull === true) {
      console.log(`[GitHub] User has pull permission -> role=read`);
      return 'read';
    }

    console.warn(`[GitHub] No role found for user '${username}' on '${repoFullName}'`);
    return null;
  } catch (error) {
    // If API call fails or JSON parsing fails, return null
    // Caller handles null case appropriately
    console.error(`[GitHub] Error getting user role: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (emailsResponse.ok) {
          const emails = (await emailsResponse.json()) as Array<{
            email: string;
            primary: boolean;
            verified: boolean;
          }>;
          // Get primary verified email, or first verified, or first email
          const primaryEmail = emails.find(e => e.primary && e.verified);
          const verifiedEmail = emails.find(e => e.verified);
          email = primaryEmail?.email || verifiedEmail?.email || emails[0]?.email || null;
        }
      } catch {
        // Ignore email fetch errors - email is optional
      }
    }

    return {
      githubId: user.id,
      username: user.login,
      email,
      avatarUrl: user.avatar_url,
    };
  } catch (error) {
    throw new UnauthorizedError('Invalid or expired GitHub access token');
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
  const [owner, repo] = repoFullName.split('/');

  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[getRepoInfo] GitHub API error:', {
        status: response.status,
        statusText: response.statusText,
        repoFullName,
        tokenPrefix: accessToken?.substring(0, 10),
        errorBody: errorBody.substring(0, 500),
      });
      return null;
    }

    const data = (await response.json()) as GitHubRepo;
    return {
      isPrivate: data.private === true,
      isOrganization: data.owner?.type === 'Organization',
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
  role_name: 'pull' | 'triage' | 'push' | 'maintain' | 'admin';
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
    pull: 'read',
    read: 'read', // GitHub can return 'read' directly
    triage: 'triage',
    push: 'write',
    write: 'write', // GitHub can return 'write' directly
    maintain: 'maintain',
    admin: 'admin',
  };

  while (true) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/collaborators?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Admin access required to view collaborators');
      }
      throw new Error(`Failed to fetch collaborators: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubCollaboratorListItem[];

    for (const collab of data) {
      collaborators.push({
        login: collab.login,
        avatarUrl: collab.avatar_url,
        htmlUrl: collab.html_url,
        permission: roleMap[collab.role_name] || 'read',
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
  const [owner, repo] = repoFullName.split('/');
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
export async function hasAdminAccessWithApp(
  repoFullName: string
): Promise<boolean> {
  const [owner, repo] = repoFullName.split('/');
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
  const [owner, repo] = repoFullName.split('/');
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
  console.log(`[GitHub] getUserRoleWithApp called for user '${username}' on repo '${repoFullName}'`);
  const [owner, repo] = repoFullName.split('/');
  try {
    const token = await getTokenForRepo(owner, repo);
    console.log(`[GitHub] Got installation token for ${repoFullName}, checking user role...`);
    const role = await getUserRole(token, repoFullName, username);
    console.log(`[GitHub] getUserRoleWithApp result: user='${username}', repo='${repoFullName}', role=${role}`);
    return role;
  } catch (error) {
    console.error(`[GitHub] getUserRoleWithApp failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
