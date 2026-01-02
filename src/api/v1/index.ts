import { FastifyInstance } from "fastify";
import { authRoutes } from "./routes/auth.routes";
import { usersRoutes } from "./routes/users.routes";
import { vaultsRoutes } from "./routes/vaults.routes";
import { secretsRoutes } from "./routes/secrets.routes";
import { activityRoutes } from "./routes/activity.routes";
import { billingRoutes } from "./routes/billing.routes";
import { integrationsRoutes } from "./routes/integrations.routes";
import { githubRoutes } from "./routes/github.routes";
import { apiKeysRoutes } from "./routes/api-keys.routes";
import { organizationsRoutes } from "./routes/organizations.routes";
import { permissionOverridesRoutes } from "./routes/permission-overrides.routes";
import { exposureRoutes } from "./routes/exposure.routes";

/**
 * API v1 Router
 * All routes are prefixed with /v1
 */
export async function apiV1Routes(fastify: FastifyInstance) {
  // Register route modules
  fastify.register(authRoutes, { prefix: "/auth" });
  fastify.register(usersRoutes, { prefix: "/users" });
  fastify.register(vaultsRoutes, { prefix: "/vaults" });
  fastify.register(secretsRoutes, { prefix: "/secrets" });
  fastify.register(activityRoutes, { prefix: "/activity" });
  fastify.register(billingRoutes, { prefix: "/billing" });
  fastify.register(integrationsRoutes, { prefix: "/integrations" });
  fastify.register(githubRoutes, { prefix: "/github" });
  fastify.register(apiKeysRoutes, { prefix: "/api-keys" });
  fastify.register(organizationsRoutes, { prefix: "/orgs" });
  // Permission overrides are nested under vaults but in separate file for clarity
  fastify.register(permissionOverridesRoutes, { prefix: "/vaults" });
  // Exposure routes are at root level since they span orgs and vaults
  fastify.register(exposureRoutes);

  // Health check for v1
  fastify.get("/health", async () => ({
    version: "v1",
    status: "ok",
    timestamp: new Date().toISOString(),
  }));
}
