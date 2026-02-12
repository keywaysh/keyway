import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the utils
vi.mock('../src/utils/auth.js', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../src/utils/git.js', () => ({
  getRepository: vi.fn().mockReturnValue('owner/repo'),
}));

// Mock pullSecrets with configurable responses
const mockPullSecrets = vi.fn();
vi.mock('../src/utils/api.js', () => ({
  pullSecrets: mockPullSecrets,
}));

describe('diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects secrets only in env1', async () => {
    mockPullSecrets
      .mockResolvedValueOnce('DATABASE_URL=postgres://localhost\nDEBUG=true')
      .mockResolvedValueOnce('DATABASE_URL=postgres://localhost');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.onlyInEnv1).toEqual(['DEBUG']);
    expect(data.stats.onlyInEnv1).toBe(1);
  });

  it('detects secrets only in env2', async () => {
    mockPullSecrets
      .mockResolvedValueOnce('DATABASE_URL=postgres://localhost')
      .mockResolvedValueOnce('DATABASE_URL=postgres://localhost\nREDIS_URL=redis://localhost');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.onlyInEnv2).toEqual(['REDIS_URL']);
    expect(data.stats.onlyInEnv2).toBe(1);
  });

  it('detects different values', async () => {
    mockPullSecrets
      .mockResolvedValueOnce('DATABASE_URL=postgres://localhost:5432')
      .mockResolvedValueOnce('DATABASE_URL=postgres://prod-db:5432');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.different).toHaveLength(1);
    expect(data.different[0].key).toBe('DATABASE_URL');
    expect(data.different[0].preview1).toContain('chars');
    expect(data.different[0].preview2).toContain('chars');
    expect(data.stats.different).toBe(1);
  });

  it('detects identical secrets', async () => {
    mockPullSecrets
      .mockResolvedValueOnce('API_KEY=secret123')
      .mockResolvedValueOnce('API_KEY=secret123');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.same).toEqual(['API_KEY']);
    expect(data.stats.same).toBe(1);
  });

  it('normalizes environment names', async () => {
    mockPullSecrets.mockResolvedValueOnce('API_KEY=secret').mockResolvedValueOnce('API_KEY=secret');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'dev', env2: 'prod' });
    const data = JSON.parse(response.content[0].text);

    expect(data.env1).toBe('development');
    expect(data.env2).toBe('production');
  });

  it('returns error when comparing same environment', async () => {
    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'dev' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Cannot compare an environment with itself');
  });

  it('returns error when both envs are missing', async () => {
    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: '', env2: '' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('required');
  });

  it('handles empty environments gracefully', async () => {
    mockPullSecrets.mockResolvedValueOnce('').mockResolvedValueOnce('API_KEY=secret');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.stats.totalEnv1).toBe(0);
    expect(data.stats.totalEnv2).toBe(1);
    expect(data.onlyInEnv2).toEqual(['API_KEY']);
  });

  it('masks secret values in previews', async () => {
    mockPullSecrets
      .mockResolvedValueOnce('SECRET=mysupersecretpassword123')
      .mockResolvedValueOnce('SECRET=anothersecretpassword456');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    // Previews should only show last 2 chars + length
    expect(data.different[0].preview1).toContain('**23');
    expect(data.different[0].preview2).toContain('**56');
    // Should not contain full secret value
    expect(response.content[0].text).not.toContain('mysupersecretpassword');
  });

  it('includes repository in response', async () => {
    mockPullSecrets.mockResolvedValueOnce('API_KEY=secret').mockResolvedValueOnce('API_KEY=secret');

    const { diff } = await import('../src/tools/diff.js');
    const response = await diff({ env1: 'development', env2: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.repository).toBe('owner/repo');
  });
});
