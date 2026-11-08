/**
 * Credentials in URLs (token, ticket, OAuth code and state) must not
 * reach logs, Sentry or PostHog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redactUrl, redactQueryString, serializeRequestForLog } from '../src/utils/logger';
import { scrubSensitiveRequestData } from '../src/utils/sentry';

const R = '[REDACTED]';

describe('redactUrl', () => {
  it('redacts token, ticket, code and state and keeps the other parameters', () => {
    expect(
      redactUrl('/v1/integrations/vercel/authorize?token=eyJ.a.b&redirect_uri=https%3A%2F%2Fapp')
    ).toBe(`/v1/integrations/vercel/authorize?token=${R}&redirect_uri=https%3A%2F%2Fapp`);
    expect(redactUrl('/v1/auth/callback?code=abc&state=xyz.sig')).toBe(
      `/v1/auth/callback?code=${R}&state=${R}`
    );
    expect(redactUrl('/v1/integrations/vercel/authorize?ticket=t.s')).toBe(
      `/v1/integrations/vercel/authorize?ticket=${R}`
    );
  });

  it('redacts repeated, encoded and differently cased names', () => {
    expect(redactUrl('/x?token=a&token=b')).toBe(`/x?token=${R}&token=${R}`);
    // The query parser decodes names: %74oken is read as token
    expect(redactUrl('/x?%74oken=a')).toBe(`/x?%74oken=${R}`);
    expect(redactUrl('/x?TOKEN=a')).toBe(`/x?TOKEN=${R}`);
  });

  it('handles absolute URLs, fragments and empty values', () => {
    expect(redactUrl('https://api.keyway.sh/v1/a?code=1#top')).toBe(
      `https://api.keyway.sh/v1/a?code=${R}#top`
    );
    expect(redactUrl('/x?token=')).toBe(`/x?token=${R}`);
    expect(redactUrl('/x?token')).toBe('/x?token');
  });

  it('leaves URLs without sensitive parameters unchanged', () => {
    expect(redactUrl('/v1/vaults/a/b')).toBe('/v1/vaults/a/b');
    expect(redactUrl('/v1/secrets/pull?repo=a%2Fb&environment=dev')).toBe(
      '/v1/secrets/pull?repo=a%2Fb&environment=dev'
    );
    expect(redactUrl('/x?tokens=1&barcode=2')).toBe('/x?tokens=1&barcode=2');
  });

  it('redactQueryString works on a bare query string', () => {
    expect(redactQueryString('code=1&page=2')).toBe(`code=${R}&page=2`);
  });
});

describe('serializeRequestForLog (pino req serializer)', () => {
  it('logs the request without the credentials in its URL', () => {
    const serialized = serializeRequestForLog({
      method: 'GET',
      url: '/v1/integrations/vercel/authorize?token=eyJhbGciOi.payload.sig',
      host: 'api.keyway.sh',
      headers: {},
      ip: '203.0.113.7',
      socket: { remotePort: 51234 },
    } as any);

    expect(serialized).toEqual({
      method: 'GET',
      url: `/v1/integrations/vercel/authorize?token=${R}`,
      host: 'api.keyway.sh',
      remoteAddress: '203.0.113.7',
      remotePort: 51234,
    });
    expect(JSON.stringify(serialized)).not.toContain('eyJhbGciOi');
  });
});

describe('scrubSensitiveRequestData (Sentry events)', () => {
  it('removes credentials from the request, contexts, spans and breadcrumbs', () => {
    const event: any = {
      transaction: 'GET /v1/integrations/vercel/authorize?token=secret-jwt',
      request: {
        url: 'https://api.keyway.sh/v1/integrations/vercel/authorize?token=secret-jwt',
        query_string: 'token=secret-jwt&x=1',
        headers: { authorization: 'Bearer secret-jwt', cookie: 'keyway_session=secret-jwt', accept: '*/*' },
        cookies: { keyway_session: 'secret-jwt' },
      },
      contexts: {
        request: { url: '/v1/auth/callback?code=secret-code&state=secret-state' },
        trace: { data: { 'http.target': '/v1/x?ticket=secret-ticket', 'http.method': 'GET' } },
      },
      spans: [{ data: { 'url.full': 'https://api.keyway.sh/v1/x?token=secret-jwt' } }],
      breadcrumbs: [{ data: { url: '/v1/x?code=secret-code' } }],
    };

    const scrubbed = scrubSensitiveRequestData(event);
    const json = JSON.stringify(scrubbed);

    for (const secret of ['secret-jwt', 'secret-code', 'secret-state', 'secret-ticket']) {
      expect(json).not.toContain(secret);
    }
    expect(scrubbed.request!.query_string).toBe(`token=${R}&x=1`);
    expect(scrubbed.request!.headers!.accept).toBe('*/*');
    expect(scrubbed.contexts!.trace!.data!['http.method']).toBe('GET');
  });

  it('accepts query strings given as pairs or objects', () => {
    const pairs = scrubSensitiveRequestData({
      request: { query_string: [['state', 's'], ['page', '1']] },
    } as any);
    expect(pairs.request!.query_string).toEqual([['state', R], ['page', '1']]);

    const object = scrubSensitiveRequestData({
      request: { query_string: { code: 'c', page: '1' } },
    } as any);
    expect(object.request!.query_string).toEqual({ code: R, page: '1' });
  });
});

describe('trackEvent (PostHog)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not send credentials found in URL-like properties', async () => {
    const capture = vi.fn();
    vi.doMock('posthog-node', () => ({
      PostHog: class {
        capture = capture;
        identify = vi.fn();
        shutdown = vi.fn();
      },
    }));
    vi.doMock('../src/config', () => ({
      config: {
        analytics: { enabled: true, posthogApiKey: 'phc_test', posthogHost: 'https://ph.test' },
        app: { frontendUrl: 'https://keyway.sh' },
      },
    }));

    const { initAnalytics, trackEvent } = await import('../src/utils/analytics');
    initAnalytics();
    trackEvent('anonymous', 'api_error', {
      endpoint: '/v1/integrations/vercel/authorize?token=secret-jwt',
      method: 'GET',
    });

    expect(capture).toHaveBeenCalledTimes(1);
    const { properties } = capture.mock.calls[0][0];
    expect(properties.endpoint).toBe(`/v1/integrations/vercel/authorize?token=${R}`);
    expect(properties.method).toBe('GET');

    vi.doUnmock('posthog-node');
    vi.doUnmock('../src/config');
  });
});
