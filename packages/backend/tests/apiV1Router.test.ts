import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, closeTestApp } from './helpers/testApp';

// Replace every route module with a stub so the real v1 router can be mounted
// without a database: only the router-level hooks are under test here.
vi.mock('../src/api/v1/routes/auth.routes', () => ({ authRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/users.routes', () => ({ usersRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/vaults.routes', () => ({
  vaultsRoutes: async (f: FastifyInstance) => {
    f.get('/:owner/:repo/secrets', async () => ({ reached: true }));
  },
}));
vi.mock('../src/api/v1/routes/secrets.routes', () => ({ secretsRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/activity.routes', () => ({ activityRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/billing.routes', () => ({ billingRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/integrations.routes', () => ({ integrationsRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/github.routes', () => ({ githubRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/api-keys.routes', () => ({ apiKeysRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/organizations.routes', () => ({ organizationsRoutes: async () => {} }));
vi.mock('../src/api/v1/routes/permission-overrides.routes', () => ({
  permissionOverridesRoutes: async () => {},
}));
vi.mock('../src/api/v1/routes/exposure.routes', () => ({ exposureRoutes: async () => {} }));

import { apiV1Routes } from '../src/api/v1';

describe('API v1 router', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    await app.register(apiV1Routes, { prefix: '/v1' });
    await app.ready();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('rejects crafted repo names on every route module before the handler runs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/vaults/attacker/..%5Cvictim-org%5Capi/secrets',
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets normal repo names through', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/vaults/acme/api/secrets' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reached: true });
  });
});
