import { FastifyInstance } from "fastify";
import { authenticateGitHub } from "../../../middleware/auth";
import { db, users } from "../../../db";
import { eq, and } from "drizzle-orm";
import { sendPaginatedData, parsePagination, buildPaginationMeta } from "../../../lib";
import { getActivityForUser } from "../../../services";

/**
 * Activity routes
 * GET /api/v1/activity - List activity logs for current user
 */
export async function activityRoutes(fastify: FastifyInstance) {
  /**
   * GET /
   * List activity logs with pagination
   */
  fastify.get(
    "/",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const vcsUser = request.vcsUser || request.githubUser!;
      const pagination = parsePagination(request.query);

      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        return sendPaginatedData(reply, [], buildPaginationMeta(pagination, 0, 0), {
          requestId: request.id,
        });
      }

      const { activities, total } = await getActivityForUser(user.id, pagination);

      return sendPaginatedData(
        reply,
        activities,
        buildPaginationMeta(pagination, total, activities.length),
        { requestId: request.id }
      );
    }
  );
}
