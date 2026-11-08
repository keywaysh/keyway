import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, closeTestApp } from './helpers/testApp';
import { validateRepoInput } from '../src/middleware/repoInput';

describe('validateRepoInput (preValidation hook)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    app.addHook('preValidation', validateRepoInput);
    app.get('/vaults/:owner/:repo/secrets', async () => ({ ok: true }));
    app.get('/orgs/:org/exposure/:username', async () => ({ ok: true }));
    app.get('/secrets/pull', async () => ({ ok: true }));
    app.post('/vaults', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it.each([
    '/vaults/attacker/..%5Cvictim-org%5Capi/secrets',
    '/vaults/attacker/..%2Fvictim-org%2Fapi/secrets',
    '/vaults/attacker/repo%3Fx=1/secrets',
    '/vaults/attacker/repo%23frag/secrets',
    '/vaults//repo/secrets',
  ])('rejects a crafted repo path %s', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
  });

  it.each(['/vaults/attacker/../secrets', '/vaults/attacker/%2E%2E/secrets'])(
    'never routes a dot-segment repo path to a handler: %s',
    async (url) => {
      // URL normalisation removes the dot segment before routing (404) — either way
      // the handler must not run with repo "..".
      const res = await app.inject({ method: 'GET', url });
      expect([400, 404]).toContain(res.statusCode);
    }
  );

  it('accepts a normal repo path', async () => {
    const res = await app.inject({ method: 'GET', url: '/vaults/acme-inc/my_repo.js/secrets' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a crafted org or username param', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/orgs/..%5Cother/exposure/bob' })).statusCode
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/orgs/acme/exposure/bob%2F..' })).statusCode
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/orgs/acme/exposure/bob' })).statusCode).toBe(
      200
    );
  });

  it('validates the repo query parameter', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/secrets/pull?repo=attacker/..%5Cvictim-org%5Capi&environment=staging',
    });
    expect(bad.statusCode).toBe(400);

    const arr = await app.inject({ method: 'GET', url: '/secrets/pull?repo=a/b&repo=c/d' });
    expect(arr.statusCode).toBe(400);

    const good = await app.inject({ method: 'GET', url: '/secrets/pull?repo=acme/api' });
    expect(good.statusCode).toBe(200);
  });

  it('validates body.repoFullName', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/vaults',
      payload: { repoFullName: 'attacker/../victim/api' },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: 'POST',
      url: '/vaults',
      payload: { repoFullName: 'acme/api' },
    });
    expect(good.statusCode).toBe(200);
  });
});
