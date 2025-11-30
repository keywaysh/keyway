import { FastifyInstance } from 'fastify';
import { authRoutes } from './routes/auth.routes';
import { usersRoutes } from './routes/users.routes';
import { vaultsRoutes } from './routes/vaults.routes';
import { secretsRoutes } from './routes/secrets.routes';
import { activityRoutes } from './routes/activity.routes';
import { billingRoutes } from './routes/billing.routes';
import { integrationsRoutes } from './routes/integrations.routes';

/**
 * API v1 Router
 * All routes are prefixed with /v1
 */
export async function apiV1Routes(fastify: FastifyInstance) {
  // Register route modules
  fastify.register(authRoutes, { prefix: '/auth' });
  fastify.register(usersRoutes, { prefix: '/users' });
  fastify.register(vaultsRoutes, { prefix: '/vaults' });
  fastify.register(secretsRoutes, { prefix: '/secrets' });
  fastify.register(activityRoutes, { prefix: '/activity' });
  fastify.register(billingRoutes, { prefix: '/billing' });
  fastify.register(integrationsRoutes, { prefix: '/integrations' });

  // Health check for v1
  fastify.get('/health', async () => ({
    version: 'v1',
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
}
