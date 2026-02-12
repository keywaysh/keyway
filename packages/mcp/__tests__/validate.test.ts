import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the utils
vi.mock('../src/utils/auth.js', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../src/utils/git.js', () => ({
  getRepository: vi.fn().mockReturnValue('owner/repo'),
}));

// Mock API with configurable responses
const mockPullSecrets = vi.fn();
vi.mock('../src/utils/api.js', () => ({
  pullSecrets: mockPullSecrets,
}));

describe('validate', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPullSecrets.mockResolvedValue('');

    // Create a temporary test directory
    testDir = join(tmpdir(), `keyway-validate-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  });

  it('validates all required secrets are present', async () => {
    mockPullSecrets.mockResolvedValue('API_KEY=secret\nDATABASE_URL=postgres://localhost');

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      required: ['API_KEY', 'DATABASE_URL'],
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.valid).toBe(true);
    expect(data.missing).toEqual([]);
    expect(data.present).toEqual(['API_KEY', 'DATABASE_URL']);
    expect(data.stats.coverage).toBe('100.0%');
  });

  it('detects missing secrets', async () => {
    mockPullSecrets.mockResolvedValue('API_KEY=secret');

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      required: ['API_KEY', 'DATABASE_URL', 'REDIS_URL'],
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.valid).toBe(false);
    expect(data.missing).toEqual(['DATABASE_URL', 'REDIS_URL']);
    expect(data.present).toEqual(['API_KEY']);
    expect(data.stats.missingCount).toBe(2);
  });

  it('identifies extra secrets not in required list', async () => {
    mockPullSecrets.mockResolvedValue('API_KEY=secret\nDEBUG_MODE=true\nLOG_LEVEL=debug');

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'development',
      required: ['API_KEY'],
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.valid).toBe(true);
    expect(data.extra).toContain('DEBUG_MODE');
    expect(data.extra).toContain('LOG_LEVEL');
  });

  it('returns error when environment is not specified', async () => {
    const { validate } = await import('../src/tools/validate.js');
    // @ts-expect-error - Testing missing required field
    const response = await validate({ required: ['API_KEY'] });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Environment is required');
  });

  it('returns error when no required secrets specified and autoDetect is false', async () => {
    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({ environment: 'production' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('No required secrets specified');
  });

  it('auto-detects env vars from Node.js code', async () => {
    mockPullSecrets.mockResolvedValue('DATABASE_URL=postgres://localhost\nAPI_KEY=secret');

    // Create test file with env var references
    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir);
    writeFileSync(
      join(srcDir, 'config.ts'),
      `
      const dbUrl = process.env.DATABASE_URL;
      const apiKey = process.env.API_KEY;
      const missing = process.env.STRIPE_SECRET_KEY;
    `
    );

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      autoDetect: true,
      path: testDir,
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.required).toContain('DATABASE_URL');
    expect(data.required).toContain('API_KEY');
    expect(data.required).toContain('STRIPE_SECRET_KEY');
    expect(data.missing).toContain('STRIPE_SECRET_KEY');
  });

  it('auto-detects env vars from Python code', async () => {
    mockPullSecrets.mockResolvedValue('');

    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir);
    writeFileSync(
      join(srcDir, 'config.py'),
      `
      import os
      db_url = os.getenv("DATABASE_URL")
      api_key = os.environ["API_KEY"]
      secret = os.environ.get("SECRET_KEY")
    `
    );

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      autoDetect: true,
      path: testDir,
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.required).toContain('DATABASE_URL');
    expect(data.required).toContain('API_KEY');
    expect(data.required).toContain('SECRET_KEY');
  });

  it('filters out common non-secret env vars', async () => {
    mockPullSecrets.mockResolvedValue('');

    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir);
    writeFileSync(
      join(srcDir, 'app.ts'),
      `
      const env = process.env.NODE_ENV;
      const port = process.env.PORT;
      const secret = process.env.JWT_SECRET;
    `
    );

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      autoDetect: true,
      path: testDir,
    });
    const data = JSON.parse(response.content[0].text);

    // NODE_ENV and PORT should be filtered out
    expect(data.required).not.toContain('NODE_ENV');
    expect(data.required).not.toContain('PORT');
    // JWT_SECRET should be included
    expect(data.required).toContain('JWT_SECRET');
  });

  it('combines manual required list with auto-detected', async () => {
    mockPullSecrets.mockResolvedValue('MANUAL_SECRET=value');

    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'config.ts'), 'const key = process.env.AUTO_DETECTED_KEY;');

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      required: ['MANUAL_SECRET'],
      autoDetect: true,
      path: testDir,
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.required).toContain('MANUAL_SECRET');
    expect(data.required).toContain('AUTO_DETECTED_KEY');
  });

  it('handles empty environment gracefully', async () => {
    mockPullSecrets.mockRejectedValue(new Error('Not found'));

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      required: ['API_KEY'],
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.valid).toBe(false);
    expect(data.missing).toEqual(['API_KEY']);
    expect(data.stats.presentCount).toBe(0);
  });

  it('includes helpful message in response', async () => {
    mockPullSecrets.mockResolvedValue('API_KEY=secret');

    const { validate } = await import('../src/tools/validate.js');

    // Test success message
    const successResponse = await validate({
      environment: 'production',
      required: ['API_KEY'],
    });
    const successData = JSON.parse(successResponse.content[0].text);
    expect(successData.message).toContain('✓');
    expect(successData.message).toContain('All');

    // Test failure message
    const failResponse = await validate({
      environment: 'production',
      required: ['API_KEY', 'MISSING_KEY'],
    });
    const failData = JSON.parse(failResponse.content[0].text);
    expect(failData.message).toContain('✗');
    expect(failData.message).toContain('Missing');
  });

  it('includes repository in response', async () => {
    mockPullSecrets.mockResolvedValue('API_KEY=secret');

    const { validate } = await import('../src/tools/validate.js');
    const response = await validate({
      environment: 'production',
      required: ['API_KEY'],
    });
    const data = JSON.parse(response.content[0].text);

    expect(data.repository).toBe('owner/repo');
  });
});
