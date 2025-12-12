import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define mocks that will be hoisted with vi.mock
const { mockGetToken, mockGetRepository, mockPullSecrets } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockGetRepository: vi.fn(),
  mockPullSecrets: vi.fn(),
}));

// Mock the utils - these are hoisted to the top
vi.mock('../src/utils/auth.js', () => ({
  getToken: mockGetToken,
}));

vi.mock('../src/utils/git.js', () => ({
  getRepository: mockGetRepository,
}));

vi.mock('../src/utils/api.js', () => ({
  pullSecrets: mockPullSecrets,
}));

// Import after mocks are set up
import { injectRun } from '../src/tools/inject-run.js';
import { pullSecrets } from '../src/utils/api.js';

describe('injectRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mock implementations
    mockGetToken.mockResolvedValue('mock-token');
    mockGetRepository.mockReturnValue('owner/repo');
    mockPullSecrets.mockResolvedValue('SECRET_KEY=mysecretvalue123\nAPI_TOKEN=sk-abc123xyz');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('command validation', () => {
    it('rejects empty command', async () => {
      const result = await injectRun({ command: '' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('command is required');
    });

    it('rejects whitespace-only command', async () => {
      const result = await injectRun({ command: '   ' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('command is required');
    });
  });

  describe('command execution', () => {
    it('runs simple command successfully', async () => {
      const result = await injectRun({ command: 'echo', args: ['hello'] });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(data.stdout).toContain('hello');
      expect(data.secretsInjected).toBe(2);
    });

    it('handles command not found', async () => {
      // Command not found throws an exception with ENOENT
      await expect(injectRun({ command: 'nonexistent-command-xyz' }))
        .rejects.toThrow('Failed to execute command');
    });

    it('handles command with non-zero exit code', async () => {
      const result = await injectRun({ command: 'false' }); // Unix command that always fails
      const data = JSON.parse(result.content[0].text);

      expect(result.isError).toBe(true);
      expect(data.exitCode).not.toBe(0);
    });
  });

  describe('secret masking', () => {
    it('masks secrets in stdout', async () => {
      // Echo the secret value
      const result = await injectRun({
        command: 'echo',
        args: ['The secret is mysecretvalue123'],
      });
      const data = JSON.parse(result.content[0].text);

      // Secret value should be masked
      expect(data.stdout).not.toContain('mysecretvalue123');
      expect(data.stdout).toContain('***REDACTED***');
    });

    it('masks multiple secrets', async () => {
      const result = await injectRun({
        command: 'echo',
        args: ['Keys: mysecretvalue123 and sk-abc123xyz'],
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.stdout).not.toContain('mysecretvalue123');
      expect(data.stdout).not.toContain('sk-abc123xyz');
    });

    it('masks base64-encoded secrets', async () => {
      // Base64 of 'mysecretvalue123' is 'bXlzZWNyZXR2YWx1ZTEyMw=='
      const result = await injectRun({
        command: 'echo',
        args: ['Encoded: bXlzZWNyZXR2YWx1ZTEyMw=='],
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.stdout).not.toContain('bXlzZWNyZXR2YWx1ZTEyMw==');
    });
  });

  describe('timeout handling', () => {
    it('caps timeout at 5 minutes', async () => {
      // Request 10 minutes, should be capped at 5
      const result = await injectRun({
        command: 'echo',
        args: ['test'],
        timeout: 600000, // 10 minutes
      });
      const data = JSON.parse(result.content[0].text);

      // Command should complete successfully (not timeout at 10 min)
      expect(data.exitCode).toBe(0);
    });
  });

  describe('environment parameter', () => {
    it('uses default environment', async () => {
      await injectRun({ command: 'echo', args: ['test'] });

      expect(pullSecrets).toHaveBeenCalledWith('owner/repo', 'development', 'mock-token');
    });

    it('uses provided environment', async () => {
      await injectRun({ command: 'echo', args: ['test'], environment: 'production' });

      expect(pullSecrets).toHaveBeenCalledWith('owner/repo', 'production', 'mock-token');
    });
  });
});

describe('maskSecrets function behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue('mock-token');
    mockGetRepository.mockReturnValue('owner/repo');
  });

  it('handles empty secrets gracefully', async () => {
    // Mock with empty secrets for this test
    mockPullSecrets.mockResolvedValue('');

    const result = await injectRun({ command: 'echo', args: ['no secrets here'] });
    const data = JSON.parse(result.content[0].text);

    expect(data.stdout).toContain('no secrets here');
    expect(data.secretsInjected).toBe(0);
  });
});
