/**
 * Behind Railway's proxy, request.ip was the proxy's address, so the
 * per-IP rate limits counted every client together. TRUST_PROXY tells Fastify which
 * proxies to trust; on Railway it defaults to one hop.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { parseTrustProxy, config, type TrustProxy } from '../src/config';

async function hitsAllowedPerClient(trustProxy: TrustProxy) {
  const app = Fastify({ logger: false, trustProxy });
  await app.register(rateLimit, { max: 2, timeWindow: '1 minute' });
  app.get('/ping', async () => 'pong');
  await app.ready();

  // Two clients behind the same proxy (inject's socket address is the proxy's)
  const statuses: Record<string, number[]> = { a: [], b: [] };
  for (const [client, ip] of [['a', '203.0.113.1'], ['a', '203.0.113.1'], ['b', '198.51.100.2']]) {
    const response = await app.inject({ method: 'GET', url: '/ping', headers: { 'x-forwarded-for': ip } });
    statuses[client].push(response.statusCode);
  }
  await app.close();
  return statuses;
}

describe('rate limiting behind a proxy', () => {
  it('without trustProxy, every client shares the proxy bucket (the production bug)', async () => {
    expect((await hitsAllowedPerClient(false)).b).toEqual([429]);
  });

  it('with the Railway default, each client has its own bucket', async () => {
    const statuses = await hitsAllowedPerClient(parseTrustProxy(undefined, true));
    expect(statuses.a).toEqual([200, 200]);
    expect(statuses.b).toEqual([200]);
  });
});

describe('parseTrustProxy', () => {
  it('defaults to one hop on Railway and to no proxy elsewhere', () => {
    expect(parseTrustProxy(undefined, true)).toBe(1);
    expect(parseTrustProxy(undefined, false)).toBe(false);
    expect(parseTrustProxy('', true)).toBe(1);
    expect(parseTrustProxy('  ', false)).toBe(false);
  });

  it('accepts true and false', () => {
    expect(parseTrustProxy('true', false)).toBe(true);
    expect(parseTrustProxy('FALSE', true)).toBe(false);
  });

  it('accepts a number of hops', () => {
    expect(parseTrustProxy('2', false)).toBe(2);
    expect(parseTrustProxy('0', true)).toBe(0);
  });

  it('accepts a comma-separated list of addresses, CIDRs and proxy-addr presets', () => {
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1', false)).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(parseTrustProxy('fd00::/8,::1,loopback', false)).toEqual(['fd00::/8', '::1', 'loopback']);
  });

  it('rejects anything else', () => {
    for (const bad of ['yes', '1.5', '-1', '10.0.0.0/33', 'fd00::/129', 'proxy.internal', '10.0.0.0/8,,']) {
      expect(() => parseTrustProxy(bad, false), bad).toThrow();
    }
  });
});

describe('config', () => {
  it('exposes trustProxy (no proxy outside Railway by default)', () => {
    expect(config.server.trustProxy).toBe(false);
  });

  it('defaults the global rate limit to 1000 requests per 15 minutes', () => {
    expect(process.env.RATE_LIMIT_MAX).toBeUndefined();
    expect(config.rateLimit.max).toBe(1000);
    expect(config.rateLimit.window).toBe('15 minutes');
  });
});
