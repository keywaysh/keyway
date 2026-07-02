import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Soft limits tests for the vault read-only feature.
 * Exercises the REAL getPrivateVaultAccess / canWriteToVault from
 * usage.service.ts with a mocked db, so regressions in the production
 * logic (not a simulation of it) fail the suite.
 */

// db.select(...).from(...).where(...).orderBy(...) resolves with mockVaultRows
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockGetEffectivePlanForVault = vi.hoisted(() => vi.fn());

vi.mock('../src/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: mockOrderBy,
        })),
      })),
    })),
  },
  vaults: { id: 'id', ownerId: 'ownerId', isPrivate: 'isPrivate', createdAt: 'createdAt' },
  usageMetrics: { userId: 'userId' },
  providerConnections: { userId: 'userId' },
}));

vi.mock('../src/services/organization.service', () => ({
  getEffectivePlanForVault: mockGetEffectivePlanForVault,
}));

// Import after mocks
import { getPrivateVaultAccess, canWriteToVault } from '../src/services/usage.service';

// The db mock returns rows already ordered by createdAt ASC (oldest first),
// matching the real query's ORDER BY.
function vaultRows(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `v${i + 1}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEffectivePlanForVault.mockResolvedValue('free');
});

describe('getPrivateVaultAccess', () => {
  it('should skip the db entirely for unlimited plans (team)', async () => {
    const result = await getPrivateVaultAccess('user-1', 'team');

    expect(result.allowedVaultIds.size).toBe(0);
    expect(result.excessVaultIds.size).toBe(0);
    expect(mockOrderBy).not.toHaveBeenCalled();
  });

  it('should allow all vaults for free plan within the 10-vault limit', async () => {
    mockOrderBy.mockResolvedValue(vaultRows(10));

    const result = await getPrivateVaultAccess('user-1', 'free');

    expect(result.allowedVaultIds.size).toBe(10);
    expect(result.excessVaultIds.size).toBe(0);
  });

  it('should mark only the newest vaults as excess for free plan beyond 10', async () => {
    mockOrderBy.mockResolvedValue(vaultRows(13));

    const result = await getPrivateVaultAccess('user-1', 'free');

    expect(result.allowedVaultIds.size).toBe(10);
    expect(result.allowedVaultIds.has('v1')).toBe(true);
    expect(result.allowedVaultIds.has('v10')).toBe(true);
    expect(result.excessVaultIds.size).toBe(3);
    expect(result.excessVaultIds.has('v11')).toBe(true);
    expect(result.excessVaultIds.has('v12')).toBe(true);
    expect(result.excessVaultIds.has('v13')).toBe(true);
  });

  it('should handle empty vault list', async () => {
    mockOrderBy.mockResolvedValue([]);

    const result = await getPrivateVaultAccess('user-1', 'free');

    expect(result.allowedVaultIds.size).toBe(0);
    expect(result.excessVaultIds.size).toBe(0);
  });
});

describe('canWriteToVault', () => {
  it('should always allow writes to public vaults without touching plans', async () => {
    const result = await canWriteToVault('user-1', 'free', 'v1', false);

    expect(result.allowed).toBe(true);
    expect(mockGetEffectivePlanForVault).not.toHaveBeenCalled();
  });

  it('should allow writes to any private vault on team plan', async () => {
    mockGetEffectivePlanForVault.mockResolvedValue('team');

    const result = await canWriteToVault('user-1', 'team', 'v99', true);

    expect(result.allowed).toBe(true);
    expect(mockOrderBy).not.toHaveBeenCalled();
  });

  it('should allow writes to any private vault on business plan', async () => {
    mockGetEffectivePlanForVault.mockResolvedValue('business');

    const result = await canWriteToVault('user-1', 'business', 'v99', true);

    expect(result.allowed).toBe(true);
  });

  it("should use the org's effective plan when it beats the user plan", async () => {
    // Free user writing to a vault owned by a Team org: org plan wins
    mockGetEffectivePlanForVault.mockResolvedValue('team');

    const result = await canWriteToVault('user-1', 'free', 'v42', true);

    expect(result.allowed).toBe(true);
    expect(mockOrderBy).not.toHaveBeenCalled();
  });

  it('should allow writes to a free-plan vault within the limit', async () => {
    mockOrderBy.mockResolvedValue(vaultRows(12));

    const result = await canWriteToVault('user-1', 'free', 'v3', true);

    expect(result.allowed).toBe(true);
  });

  it('should deny writes to an excess free-plan vault with an actionable reason', async () => {
    mockOrderBy.mockResolvedValue(vaultRows(12));

    const result = await canWriteToVault('user-1', 'free', 'v11', true);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('free plan limit of 10 private vaults');
    expect(result.reason).toContain('Upgrade to Team');
  });

  it('should deny writes to every excess vault', async () => {
    mockOrderBy.mockResolvedValue(vaultRows(12));

    expect((await canWriteToVault('user-1', 'free', 'v11', true)).allowed).toBe(false);
    expect((await canWriteToVault('user-1', 'free', 'v12', true)).allowed).toBe(false);
  });
});
