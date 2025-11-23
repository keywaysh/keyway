import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '../errors';
import { getUserFromToken, hasRepoAccess, hasAdminAccess } from '../utils/github';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    accessToken?: string;
    githubUser?: {
      githubId: number;
      username: string;
      email: string | null;
      avatarUrl: string | null;
    };
  }
}

/**
 * Extract and validate Authorization header
 */
export async function authenticateGitHub(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError('Authorization header required');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authorization header must use Bearer scheme');
  }

  const accessToken = authHeader.substring(7);

  if (!accessToken) {
    throw new UnauthorizedError('Access token is required');
  }

  // Verify token and get user info
  const githubUser = await getUserFromToken(accessToken);

  // Attach to request for use in route handlers
  request.accessToken = accessToken;
  request.githubUser = githubUser;
}

/**
 * Verify user has access to a repository (collaborator or admin)
 * Requires authenticateGitHub to be called first
 */
export async function requireRepoAccess(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!request.accessToken) {
    throw new UnauthorizedError('Authentication required');
  }

  // Get repo name from params (encoded) or body
  const params = request.params as { repo?: string };
  const body = request.body as { repoFullName?: string };

  const repoFullName = params.repo
    ? decodeURIComponent(params.repo)
    : body?.repoFullName;

  if (!repoFullName) {
    throw new ForbiddenError('Repository name required');
  }

  const hasAccess = await hasRepoAccess(request.accessToken, repoFullName);

  if (!hasAccess) {
    throw new ForbiddenError('You do not have access to this repository');
  }
}

/**
 * Verify user has admin access to a repository
 * Requires authenticateGitHub to be called first
 */
export async function requireAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!request.accessToken) {
    throw new UnauthorizedError('Authentication required');
  }

  const body = request.body as { repoFullName?: string };
  const repoFullName = body?.repoFullName;

  if (!repoFullName) {
    throw new ForbiddenError('Repository name required');
  }

  const isAdmin = await hasAdminAccess(request.accessToken, repoFullName);

  if (!isAdmin) {
    throw new ForbiddenError('Only repository admins can perform this action');
  }
}
