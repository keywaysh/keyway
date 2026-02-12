import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scan } from '../src/tools/scan.js';

describe('scan', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `keyway-scan-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  });

  it('detects GitHub PAT tokens', async () => {
    const file = join(testDir, 'config.ts');
    writeFileSync(file, 'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(1);
    expect(data.findings[0].type).toBe('GitHub PAT');
    expect(data.findings[0].preview).toContain('ghp_');
    expect(data.findings[0].preview).not.toContain('1234567890'); // Should be masked
  });

  it('detects AWS Access Keys', async () => {
    const file = join(testDir, 'aws.ts');
    // Using a realistic fake key (not containing "example" which triggers false positive detection)
    writeFileSync(file, 'const accessKey = "AKIAIOSFODNN7ABCDEFG";');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(1);
    expect(data.findings[0].type).toBe('AWS Access Key');
  });

  it('detects Stripe Secret Keys', async () => {
    const file = join(testDir, 'stripe.ts');
    writeFileSync(file, 'const stripeKey = "sk_live_1234567890abcdefghijklmn";');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(1);
    expect(data.findings[0].type).toBe('Stripe Secret Key');
  });

  it('detects Private Key headers', async () => {
    const file = join(testDir, 'key.pem');
    writeFileSync(
      file,
      '-----BEGIN RSA PRIVATE KEY-----\nbase64data\n-----END RSA PRIVATE KEY-----'
    );

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(1);
    expect(data.findings[0].type).toBe('Private Key');
  });

  it('skips test files (false positive detection)', async () => {
    const file = join(testDir, 'config.test.ts');
    writeFileSync(file, 'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(0);
  });

  it('skips placeholder values', async () => {
    const file = join(testDir, 'config.ts');
    writeFileSync(file, 'const token = "ghp_your_token_here_placeholder_xxxxx";');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(0);
  });

  it('skips environment variable references', async () => {
    const file = join(testDir, 'config.ts');
    writeFileSync(file, 'const token = process.env.GITHUB_TOKEN;');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(0);
  });

  it('skips binary files', async () => {
    const file = join(testDir, 'image.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.filesScanned).toBe(0);
  });

  it('excludes node_modules by default', async () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules);
    writeFileSync(
      join(nodeModules, 'secret.js'),
      'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";'
    );

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(0);
  });

  it('respects custom exclude patterns', async () => {
    const customDir = join(testDir, 'secrets');
    mkdirSync(customDir);
    writeFileSync(
      join(customDir, 'config.ts'),
      'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";'
    );

    const response = await scan({ path: testDir, exclude: ['secrets'] });
    const data = JSON.parse(response.content[0].text);

    expect(data.findingsCount).toBe(0);
  });

  it('returns error for non-existent path', async () => {
    const response = await scan({ path: '/nonexistent/path' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('does not exist');
  });

  it('scans multiple files', async () => {
    writeFileSync(
      join(testDir, 'file1.ts'),
      'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";'
    );
    writeFileSync(join(testDir, 'file2.ts'), 'const stripe = "sk_live_1234567890abcdefghijklmn";');
    writeFileSync(join(testDir, 'file3.ts'), 'const clean = "no secrets here";');

    const response = await scan({ path: testDir });
    const data = JSON.parse(response.content[0].text);

    expect(data.filesScanned).toBe(3);
    expect(data.findingsCount).toBe(2);
  });
});
