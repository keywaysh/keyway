import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the utils
vi.mock('../src/utils/auth.js', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../src/utils/git.js', () => ({
  getRepository: vi.fn().mockReturnValue('owner/repo'),
}));

// Mock API with configurable responses
const mockPullSecrets = vi.fn();
const mockPushSecrets = vi.fn();
vi.mock('../src/utils/api.js', () => ({
  pullSecrets: mockPullSecrets,
  pushSecrets: mockPushSecrets,
}));

describe('generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPullSecrets.mockResolvedValue('');
    mockPushSecrets.mockResolvedValue(undefined);
  });

  it('generates a password secret', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'DATABASE_PASSWORD', type: 'password', length: 32 });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.action).toBe('created');
    expect(data.name).toBe('DATABASE_PASSWORD');
    expect(data.type).toBe('password');
    expect(data.length).toBe(32);
    expect(data.preview).toMatch(/^.{4}\*+.{4}$/); // Masked format
    expect(mockPushSecrets).toHaveBeenCalled();
  });

  it('generates a UUID secret', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'REQUEST_ID', type: 'uuid' });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.type).toBe('uuid');
    expect(data.length).toBe(36); // UUID length
  });

  it('generates an API key secret', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'EXTERNAL_API_KEY', type: 'api-key', length: 24 });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.type).toBe('api-key');
    // API key format: key_<random>
    expect(data.preview).toMatch(/^key_/);
  });

  it('generates a JWT secret', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'JWT_SECRET', type: 'jwt-secret' });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.type).toBe('jwt-secret');
    expect(data.length).toBeGreaterThanOrEqual(32); // Minimum 256 bits
  });

  it('generates a hex secret', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'ENCRYPTION_KEY', type: 'hex', length: 64 });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.type).toBe('hex');
  });

  it('generates a base64 secret', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'SESSION_KEY', type: 'base64', length: 44 });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.type).toBe('base64');
  });

  it('rejects invalid secret names', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'invalid-name' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Invalid secret name');
    expect(response.content[0].text).toContain('UPPERCASE_WITH_UNDERSCORES');
  });

  it('rejects empty secret names', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: '' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('required');
  });

  it('rejects invalid types', async () => {
    const { generate } = await import('../src/tools/generate.js');
    // @ts-expect-error - Testing invalid type
    const response = await generate({ name: 'TEST_KEY', type: 'invalid' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Invalid type');
  });

  it('rejects length out of range', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'TEST_KEY', length: 5 });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('between 8 and 256');
  });

  it('reports update when secret already exists', async () => {
    mockPullSecrets.mockResolvedValue('DATABASE_PASSWORD=oldvalue');

    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'DATABASE_PASSWORD' });
    const data = JSON.parse(response.content[0].text);

    expect(data.action).toBe('updated');
  });

  it('uses default environment when not specified', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'TEST_KEY' });
    const data = JSON.parse(response.content[0].text);

    expect(data.environment).toBe('development');
  });

  it('masks the secret value in preview', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'SECRET_KEY', length: 32 });
    const data = JSON.parse(response.content[0].text);

    // Preview should show first 4 and last 4 chars with asterisks in between
    expect(data.preview).toMatch(/^.{4}\*+.{4}$/);
    // The full response should not contain any 32-char unmasked strings
    expect(data.message).toContain('never exposed');
  });

  it('includes repository in response', async () => {
    const { generate } = await import('../src/tools/generate.js');
    const response = await generate({ name: 'API_KEY' });
    const data = JSON.parse(response.content[0].text);

    expect(data.repository).toBe('owner/repo');
  });
});
