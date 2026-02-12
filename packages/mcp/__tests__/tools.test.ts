import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the utils
vi.mock('../src/utils/auth.js', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../src/utils/git.js', () => ({
  getRepository: vi.fn().mockReturnValue('owner/repo'),
}));

vi.mock('../src/utils/api.js', () => ({
  pullSecrets: vi.fn().mockResolvedValue('DATABASE_URL=postgres://localhost\nAPI_KEY=secret'),
  pushSecrets: vi.fn().mockResolvedValue({ stats: { created: 1 } }),
  getVaultEnvironments: vi.fn().mockResolvedValue(['development', 'staging', 'production']),
}));

describe('listSecrets', async () => {
  const { listSecrets } = await import('../src/tools/list-secrets.js');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns secret names without values', async () => {
    const response = await listSecrets({});
    const data = JSON.parse(response.content[0].text);

    expect(data.secrets).toEqual(['API_KEY', 'DATABASE_URL']);
    expect(data.count).toBe(2);
    expect(data.environment).toBe('development');
    // Should not contain actual secret values
    expect(response.content[0].text).not.toContain('postgres://localhost');
  });

  it('uses provided environment', async () => {
    const response = await listSecrets({ environment: 'production' });
    const data = JSON.parse(response.content[0].text);

    expect(data.environment).toBe('production');
  });
});

describe('setSecret', async () => {
  const { setSecret } = await import('../src/tools/set-secret.js');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates secret name format', async () => {
    const response = await setSecret({ name: 'invalid-name', value: 'test' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('uppercase');
  });

  it('accepts valid secret names', async () => {
    const response = await setSecret({ name: 'VALID_NAME', value: 'test' });
    const data = JSON.parse(response.content[0].text);

    expect(data.success).toBe(true);
    expect(data.name).toBe('VALID_NAME');
  });
});

describe('listEnvironments', async () => {
  const { listEnvironments } = await import('../src/tools/list-environments.js');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns environment list', async () => {
    const response = await listEnvironments();
    const data = JSON.parse(response.content[0].text);

    expect(data.environments).toEqual(['development', 'staging', 'production']);
    expect(data.count).toBe(3);
  });
});
