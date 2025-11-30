import { z } from 'zod';
import { config } from '../config';
import { UnauthorizedError } from '../lib';
import type { CollaboratorRole } from '../db/schema';

const GITHUB_API_BASE = config.github.apiBaseUrl;

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
      return null;
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;

    // Check if user is the repository owner (for personal repos)
    // Owners have admin access but don't appear in the collaborators list
    if (repoData.owner?.login === username) {
      return 'admin';
    }

    // If they have admin permission via the basic permissions check
    if (repoData.permissions?.admin === true) {
      return 'admin';
    }

    // Try to get detailed collaborator role (for orgs and invited collaborators)
    const collabResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/collaborators/${username}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (collabResponse.ok) {
      const data = (await collabResponse.json()) as GitHubCollaborator;

      // Map GitHub's role_name to our CollaboratorRole type
      const roleMap: Record<string, CollaboratorRole> = {
        pull: 'read',
        triage: 'triage',
        push: 'write',
        maintain: 'maintain',
        admin: 'admin',
      };

      return roleMap[data.role_name] || null;
    }

    // Fall back to basic permissions if collaborator API doesn't work
    if (repoData.permissions?.push === true) {
      return 'write';
    }
    if (repoData.permissions?.pull === true) {
      return 'read';
    }

    return null;
  } catch {
    // If API call fails or JSON parsing fails, return null
    // Caller handles null case appropriately
    return null;
  }
}

/**
 * Get GitHub user from access token
 */
export async function getUserFromToken(accessToken: string) {
  try {
    const user = await getGitHubUser(accessToken);
    return {
      githubId: user.id,
      username: user.login,
      email: user.email,
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
