import { FastifyInstance } from "fastify";
import { authenticateGitHub } from "../../../middleware/auth";
import { db, users } from "../../../db";
import { eq, and } from "drizzle-orm";
import { sendData, ForbiddenError } from "../../../lib";
import { getUserUsageResponse } from "../../../services";
import { getPlanLimits, formatLimit } from "../../../config/plans";
import {
  getSecurityAlertsForUser,
  getSecurityOverview,
  getAccessLog,
} from "../../../services/security.service";
import {
  getExposureForUserGlobal,
  getExposureForUserByUsername,
} from "../../../services/exposure.service";
import { getEffectivePlanForUser } from "../../../services/trial.service";
import { PlanLimitError } from "../../../lib";

/**
 * User routes
 * GET /api/v1/users/me - Get current user profile
 * GET /api/v1/users/me/usage - Get current user usage and plan limits
 * GET /api/v1/users/me/security/overview - Get security overview dashboard
 * GET /api/v1/users/me/security/alerts - Get security alerts across all user's vaults
 * GET /api/v1/users/me/security/access-log - Get access log (pull events)
 * GET /api/v1/users/me/exposure - Get global exposure summary (Team plan)
 * GET /api/v1/users/me/exposure/:username - Get exposure for a specific user (Team plan)
 */
export async function usersRoutes(fastify: FastifyInstance) {
  /**
   * GET /me
   * Return the authenticated user profile
   */
  fastify.get(
    "/me",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
            plan: "free",
            createdAt: null,
          };

      return sendData(reply, userData, { requestId: request.id });
    }
  );

  /**
   * GET /me/usage
   * Return the user's current usage and plan limits
   */
  fastify.get(
    "/me/usage",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        const freeLimits = getPlanLimits("free");
        return sendData(
          reply,
          {
            plan: "free",
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
          },
          { requestId: request.id }
        );
      }

      const usageResponse = await getUserUsageResponse(user.id, user.plan);
      return sendData(reply, usageResponse, { requestId: request.id });
    }
  );

  /**
   * GET /me/security/alerts
   * Return security alerts across all vaults the user has accessed
   */
  fastify.get(
    "/me/security/alerts",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const vcsUser = request.vcsUser || request.githubUser!;
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50", 10), 100);
      const offset = parseInt(query.offset || "0", 10);

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

      return sendData(
        reply,
        alerts.map((a) => ({
          id: a.id,
          type: a.alertType,
          message: a.message,
          createdAt: a.createdAt,
          vault: a.vault ? { repoFullName: a.vault.repoFullName } : null,
          event: a.pullEvent
            ? {
                ip: a.pullEvent.ip,
                location: { country: a.pullEvent.country, city: a.pullEvent.city },
                deviceId: a.pullEvent.deviceId,
              }
            : null,
        })),
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /me/security/overview
   * Return the security overview dashboard with aggregated stats
   */
  fastify.get(
    "/me/security/overview",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const vcsUser = request.vcsUser || request.githubUser!;

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        return sendData(
          reply,
          {
            alerts: { total: 0, critical: 0, warning: 0, last7Days: 0, last30Days: 0 },
            access: { uniqueUsers: 0, totalPulls: 0, last7Days: 0, topVaults: [], topUsers: [] },
            exposure: { usersWithAccess: 0, secretsAccessed: 0, lastAccessAt: null },
          },
          { requestId: request.id }
        );
      }

      const overview = await getSecurityOverview(user.id);
      return sendData(reply, overview, { requestId: request.id });
    }
  );

  /**
   * GET /me/security/access-log
   * Return paginated access log (pull events)
   */
  fastify.get(
    "/me/security/access-log",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const vcsUser = request.vcsUser || request.githubUser!;
      const query = request.query as { limit?: string; offset?: string; vaultId?: string };
      const limit = Math.min(parseInt(query.limit || "50", 10), 100);
      const offset = parseInt(query.offset || "0", 10);
      const vaultId = query.vaultId || undefined;

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        return sendData(reply, { events: [], total: 0 }, { requestId: request.id });
      }

      const accessLog = await getAccessLog(user.id, { limit, offset, vaultId });
      return sendData(reply, accessLog, { requestId: request.id });
    }
  );

  /**
   * GET /me/exposure
   * Return global exposure summary (Team plan only)
   */
  fastify.get(
    "/me/exposure",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const vcsUser = request.vcsUser || request.githubUser!;
      const query = request.query as {
        startDate?: string;
        endDate?: string;
        limit?: string;
        offset?: string;
      };

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Check Team plan
      const effectivePlan = await getEffectivePlanForUser(user.id);
      if (effectivePlan !== "team") {
        throw new PlanLimitError(
          "Exposure reports require a Team plan. Upgrade to track which secrets your team members have accessed."
        );
      }

      const exposure = await getExposureForUserGlobal(user.id, {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : 100,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });

      return sendData(reply, exposure, { requestId: request.id });
    }
  );

  /**
   * GET /me/exposure/:username
   * Return exposure for a specific user (Team plan only)
   */
  fastify.get<{ Params: { username: string } }>(
    "/me/exposure/:username",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { username } = request.params;
      const vcsUser = request.vcsUser || request.githubUser!;

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Check Team plan
      const effectivePlan = await getEffectivePlanForUser(user.id);
      if (effectivePlan !== "team") {
        throw new PlanLimitError(
          "Exposure reports require a Team plan. Upgrade to track which secrets your team members have accessed."
        );
      }

      const exposure = await getExposureForUserByUsername(user.id, username);
      return sendData(reply, exposure, { requestId: request.id });
    }
  );
}
