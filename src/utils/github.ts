import { z } from 'zod';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from '../errors';

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
  permissions?: {
    push?: boolean;
    admin?: boolean;
  };
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

  const data = (await response.json()) as GitHubTokenResponse;

  if (!data.access_token) {
    throw new Error('No access token received from GitHub');
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
  const [owner, repo] = repoFullName.split('/');

  // First, try to get the repository (will fail if no access)
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

  // Check if user has push access (collaborator or admin)
  return repoData.permissions?.push === true || repoData.permissions?.admin === true;
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
