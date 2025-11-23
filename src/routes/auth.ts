import { FastifyInstance } from 'fastify';
import { GitHubCallbackRequestSchema } from '../types';
import { db, users } from '../db';
import { eq } from 'drizzle-orm';
import { exchangeCodeForToken, getUserFromToken } from '../utils/github';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /auth/github/callback
   * Exchange GitHub OAuth code for access token and create/update user
   */
  fastify.post('/auth/github/callback', async (request, reply) => {
    try {
      const body = GitHubCallbackRequestSchema.parse(request.body);

      // Exchange code for access token
      const accessToken = await exchangeCodeForToken(body.code);

      // Get user info from GitHub
      const githubUser = await getUserFromToken(accessToken);

      // Check if user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.githubId, githubUser.githubId),
      });

      let user;

      if (existingUser) {
        // Update existing user
        const [updatedUser] = await db
          .update(users)
          .set({
            username: githubUser.username,
            email: githubUser.email,
            avatarUrl: githubUser.avatarUrl,
            accessToken,
            updatedAt: new Date(),
          })
          .where(eq(users.githubId, githubUser.githubId))
          .returning();

        user = updatedUser;
      } else {
        // Create new user
        const [newUser] = await db
          .insert(users)
          .values({
            githubId: githubUser.githubId,
            username: githubUser.username,
            email: githubUser.email,
            avatarUrl: githubUser.avatarUrl,
            accessToken,
          })
          .returning();

        user = newUser;
      }

      // Track successful auth
      trackEvent(user.id, AnalyticsEvents.AUTH_SUCCESS, {
        username: githubUser.username,
        isNewUser: !existingUser,
      });

      return {
        accessToken,
        user: {
          id: githubUser.githubId,
          username: githubUser.username,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
        },
      };
    } catch (error) {
      trackEvent('anonymous', AnalyticsEvents.AUTH_FAILURE, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        return reply.status(400).send({
          error: 'AuthenticationError',
          message: error.message,
        });
      }

      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to authenticate with GitHub',
      });
    }
  });
}
