import { FastifyInstance } from 'fastify';
import { authenticateGitHub } from '../../../middleware/auth';
import { db, users } from '../../../db';
import { eq } from 'drizzle-orm';
import { sendData } from '../../../lib';
import { getUserUsageResponse } from '../../../services';
import { getPlanLimits, formatLimit } from '../../../config/plans';

/**
 * User routes
 * GET /api/v1/users/me - Get current user profile
 * GET /api/v1/users/me/usage - Get current user usage and plan limits
 */
export async function usersRoutes(fastify: FastifyInstance) {
  /**
   * GET /me
   * Return the authenticated user profile
   */
  fastify.get('/me', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const githubUser = request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    const userData = user
      ? {
          id: user.id,
          githubId: user.githubId,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          plan: user.plan,
          createdAt: user.createdAt.toISOString(),
        }
      : {
          id: null,
          githubId: githubUser.githubId,
          username: githubUser.username,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
          plan: 'free',
          createdAt: null,
        };

    return sendData(reply, userData, { requestId: request.id });
  });

  /**
   * GET /me/usage
   * Return the user's current usage and plan limits
   */
  fastify.get('/me/usage', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const githubUser = request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    // If user doesn't exist in DB yet, return default free plan limits with zero usage
    if (!user) {
      const freeLimits = getPlanLimits('free');
      return sendData(reply, {
        plan: 'free',
        limits: {
          maxPublicRepos: formatLimit(freeLimits.maxPublicRepos),
          maxPrivateRepos: formatLimit(freeLimits.maxPrivateRepos),
          maxProviders: formatLimit(freeLimits.maxProviders),
          maxEnvironmentsPerVault: formatLimit(freeLimits.maxEnvironmentsPerVault),
          maxSecretsPerPrivateVault: formatLimit(freeLimits.maxSecretsPerPrivateVault),
        },
        usage: {
          public: 0,
          private: 0,
          providers: 0,
        },
      }, { requestId: request.id });
    }

    const usageResponse = await getUserUsageResponse(user.id, user.plan);
    return sendData(reply, usageResponse, { requestId: request.id });
  });
}
