import { FastifyInstance } from 'fastify';
import { authenticateGitHub } from '../../../middleware/auth';
import { db, users } from '../../../db';
import { eq, and } from 'drizzle-orm';
import { sendData } from '../../../lib';
import { getUserUsageResponse } from '../../../services';
import { getPlanLimits, formatLimit } from '../../../config/plans';
import { getSecurityAlertsForUser } from '../../../services/security.service';

/**
 * User routes
 * GET /api/v1/users/me - Get current user profile
 * GET /api/v1/users/me/usage - Get current user usage and plan limits
 * GET /api/v1/users/me/security/alerts - Get security alerts across all user's vaults
 */
export async function usersRoutes(fastify: FastifyInstance) {
  /**
   * GET /me
   * Return the authenticated user profile
   */
  fastify.get('/me', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    const userData = user
      ? {
          id: user.id,
          forgeType: user.forgeType,
          forgeUserId: user.forgeUserId,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          plan: user.plan,
          createdAt: user.createdAt.toISOString(),
        }
      : {
          id: null,
          forgeType: vcsUser.forgeType,
          forgeUserId: vcsUser.forgeUserId,
          username: vcsUser.username,
          email: vcsUser.email,
          avatarUrl: vcsUser.avatarUrl,
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
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
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

  /**
   * GET /me/security/alerts
   * Return security alerts across all vaults the user has accessed
   */
  fastify.get('/me/security/alerts', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const vcsUser = request.vcsUser || request.githubUser!;
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    // If user doesn't exist in DB yet, return empty array
    if (!user) {
      return sendData(reply, [], { requestId: request.id });
    }

    const alerts = await getSecurityAlertsForUser(user.id, limit, offset);

    return sendData(reply, alerts.map(a => ({
      id: a.id,
      type: a.alertType,
      message: a.message,
      createdAt: a.createdAt,
      vault: a.vault ? { repoFullName: a.vault.repoFullName } : null,
      event: a.pullEvent ? {
        ip: a.pullEvent.ip,
        location: { country: a.pullEvent.country, city: a.pullEvent.city },
        deviceId: a.pullEvent.deviceId,
      } : null,
    })), { requestId: request.id });
  });
}
