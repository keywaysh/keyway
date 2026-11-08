import { describe, it, expect, vi } from 'vitest';
import { runBackfillForgeRepoIds, type BackfillDeps } from '../src/scripts/backfillForgeRepoIdsCli';

const vault = (id: string, repoFullName: string, createdAt: string) => ({
  id,
  repoFullName,
  createdAt: new Date(createdAt),
});

function makeDeps(overrides: Partial<BackfillDeps> = {}): BackfillDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    listUnboundVaults: vi.fn().mockResolvedValue([]),
    getRepoInfo: vi.fn().mockResolvedValue(null),
    isRepoIdBound: vi.fn().mockResolvedValue(false),
    bindVault: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function run(args: string[], deps: ReturnType<typeof makeDeps>) {
  return runBackfillForgeRepoIds(args, (line) => deps.lines.push(line), deps);
}

describe('backfill forge repo ids', () => {
  it('binds nothing in dry-run mode', async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault('v1', 'acme/api', '2025-06-01')]),
      getRepoInfo: vi.fn().mockResolvedValue({
        repoId: '42',
        fullName: 'acme/api',
        createdAt: new Date('2024-01-01'),
      }),
    });

    expect(await run([], deps)).toBe(0);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join('\n')).toMatch(/would bind.*v1.*42/);
  });

  it('binds a vault to the repository that existed before it (--apply)', async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault('v1', 'acme/api', '2025-06-01')]),
      getRepoInfo: vi.fn().mockResolvedValue({
        repoId: '42',
        fullName: 'acme/api',
        createdAt: new Date('2024-01-01'),
      }),
    });

    expect(await run(['--apply'], deps)).toBe(0);
    expect(deps.bindVault).toHaveBeenCalledWith('v1', '42');
  });

  it('follows a rename: GitHub only redirects to the same repository', async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault('v1', 'acme/old', '2025-06-01')]),
      getRepoInfo: vi.fn().mockResolvedValue({
        repoId: '42',
        fullName: 'acme/new',
        createdAt: new Date('2024-01-01'),
      }),
    });

    await run(['--apply'], deps);
    expect(deps.bindVault).toHaveBeenCalledWith('v1', '42');
  });

  it('refuses a repository created after the vault (name reused by another repo)', async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault('v1', 'acme/api', '2025-06-01')]),
      getRepoInfo: vi.fn().mockResolvedValue({
        repoId: '99',
        fullName: 'acme/api',
        createdAt: new Date('2025-09-01'),
      }),
    });

    await run(['--apply'], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join('\n')).toMatch(/v1.*created after the vault/);
  });

  it('skips vaults it cannot verify', async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([
        vault('gone', 'acme/deleted', '2025-06-01'),
        vault('nodate', 'acme/nodate', '2025-06-01'),
      ]),
      getRepoInfo: vi.fn().mockImplementation(async (name: string) =>
        name === 'acme/nodate' ? { repoId: '7', fullName: 'acme/nodate', createdAt: null } : null
      ),
    });

    await run(['--apply'], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    const out = deps.lines.join('\n');
    expect(out).toMatch(/gone.*unresolved/);
    expect(out).toMatch(/nodate.*no creation date/);
  });

  it('skips a repository id already bound to another vault', async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault('v2', 'acme/api', '2025-06-01')]),
      getRepoInfo: vi.fn().mockResolvedValue({
        repoId: '42',
        fullName: 'acme/api',
        createdAt: new Date('2024-01-01'),
      }),
      isRepoIdBound: vi.fn().mockResolvedValue(true),
    });

    await run(['--apply'], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join('\n')).toMatch(/v2.*already bound to another vault/);
  });
});
