import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = process.env;

describe('API module - HTTPS validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('allows HTTPS URLs', async () => {
    process.env.KEYWAY_API_URL = 'https://api.keyway.sh';
    // Should not throw
    await expect(import('../src/utils/api.js')).resolves.toBeDefined();
  });

  it('allows localhost HTTP URLs', async () => {
    process.env.KEYWAY_API_URL = 'http://localhost:3000';
    await expect(import('../src/utils/api.js')).resolves.toBeDefined();
  });

  it('allows 127.0.0.1 HTTP URLs', async () => {
    process.env.KEYWAY_API_URL = 'http://127.0.0.1:3000';
    await expect(import('../src/utils/api.js')).resolves.toBeDefined();
  });

  it('rejects non-localhost HTTP URLs', async () => {
    process.env.KEYWAY_API_URL = 'http://evil.com';
    await expect(import('../src/utils/api.js')).rejects.toThrow('HTTPS is required');
  });
});

// These tests need to be in a separate describe block and import before the module is loaded
describe('Environment validation', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Use valid URL for these tests
    process.env.KEYWAY_API_URL = 'https://api.keyway.sh';
    // Mock fetch with a non-retryable error (avoid "network", "timeout", "econnreset", "econnrefused")
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Mocked fetch failure'));
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('accepts valid environment names', async () => {
    const { pullSecrets } = await import('../src/utils/api.js');

    // These should not throw validation errors (will throw fetch error instead)
    await expect(pullSecrets('owner/repo', 'development', 'token')).rejects.toThrow('Mocked fetch failure');
    await expect(pullSecrets('owner/repo', 'staging', 'token')).rejects.toThrow('Mocked fetch failure');
    await expect(pullSecrets('owner/repo', 'production', 'token')).rejects.toThrow('Mocked fetch failure');
    await expect(pullSecrets('owner/repo', 'my-env-123', 'token')).rejects.toThrow('Mocked fetch failure');
  });

  it('rejects invalid environment names', async () => {
    const { pullSecrets } = await import('../src/utils/api.js');

    await expect(pullSecrets('owner/repo', '', 'token')).rejects.toThrow('Invalid environment');
    await expect(pullSecrets('owner/repo', '123invalid', 'token')).rejects.toThrow('Invalid environment');
    await expect(pullSecrets('owner/repo', 'has spaces', 'token')).rejects.toThrow('Invalid environment');
    await expect(pullSecrets('owner/repo', 'has@special', 'token')).rejects.toThrow('Invalid environment');
  });
});

describe('APIError', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.KEYWAY_API_URL = 'https://api.keyway.sh';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('creates error with correct properties', async () => {
    const { APIError } = await import('../src/utils/api.js');

    const error = new APIError(404, 'NOT_FOUND', 'Resource not found');
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe('NOT_FOUND');
    expect(error.message).toBe('Resource not found');
    expect(error.name).toBe('APIError');
  });

  it('supports retryable flag', async () => {
    const { APIError } = await import('../src/utils/api.js');

    const retryableError = new APIError(500, 'SERVER_ERROR', 'Internal error', true);
    expect(retryableError.isRetryable).toBe(true);

    const nonRetryableError = new APIError(400, 'BAD_REQUEST', 'Bad request');
    expect(nonRetryableError.isRetryable).toBe(false);
  });
});
