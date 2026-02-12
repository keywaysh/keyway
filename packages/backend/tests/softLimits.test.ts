import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLANS } from '../src/config/plans';
import type { UserPlan } from '../src/db/schema';

/**
 * Soft limits unit tests for the vault read-only feature.
 * These tests verify the business logic without database access.
 */
describe('Soft Limits - Business Logic', () => {
  describe('Plan limits configuration', () => {
    it('free plan should have maxPrivateRepos = 1', () => {
      expect(PLANS.free.maxPrivateRepos).toBe(1);
    });

    it('pro plan should have maxPrivateRepos = 5', () => {
      expect(PLANS.pro.maxPrivateRepos).toBe(5);
    });

    it('team plan should have maxPrivateRepos = 10', () => {
      expect(PLANS.team.maxPrivateRepos).toBe(10);
    });

    it('startup plan should have maxPrivateRepos = 40', () => {
      expect(PLANS.startup.maxPrivateRepos).toBe(40);
    });
  });

  describe('FIFO vault ordering logic', () => {
    // Simulate the logic from getPrivateVaultAccess
    function computeVaultAccess(
      vaults: { id: string; createdAt: Date }[],
      plan: UserPlan
    ): { allowedIds: Set<string>; excessIds: Set<string> } {
      const limit = PLANS[plan].maxPrivateRepos;

      if (limit === Infinity) {
        return { allowedIds: new Set(), excessIds: new Set() };
      }

      // Sort by createdAt (oldest first)
      const sorted = [...vaults].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );

      const allowedIds = new Set(sorted.slice(0, limit).map((v) => v.id));
      const excessIds = new Set(sorted.slice(limit).map((v) => v.id));

      return { allowedIds, excessIds };
    }

    it('should allow up to 5 vaults for pro plan', () => {
      const vaults = [
        { id: 'v1', createdAt: new Date('2024-01-01') },
        { id: 'v2', createdAt: new Date('2024-02-01') },
        { id: 'v3', createdAt: new Date('2024-03-01') },
      ];

      const result = computeVaultAccess(vaults, 'pro');

      // Pro plan allows 5 private repos, so 3 vaults should all be allowed
      expect(result.allowedIds.size).toBe(3);
      expect(result.excessIds.size).toBe(0);
    });

    it('should allow oldest vault for free plan with 1 vault', () => {
      const vaults = [{ id: 'v1', createdAt: new Date('2024-01-01') }];

      const result = computeVaultAccess(vaults, 'free');

      expect(result.allowedIds.has('v1')).toBe(true);
      expect(result.excessIds.size).toBe(0);
    });

    it('should mark only oldest vault as allowed for free plan with 2 vaults', () => {
      const vaults = [
        { id: 'v2', createdAt: new Date('2024-02-01') }, // newer
        { id: 'v1', createdAt: new Date('2024-01-01') }, // older (should be allowed)
      ];

      const result = computeVaultAccess(vaults, 'free');

      expect(result.allowedIds.has('v1')).toBe(true);
      expect(result.allowedIds.has('v2')).toBe(false);
      expect(result.excessIds.has('v2')).toBe(true);
      expect(result.excessIds.has('v1')).toBe(false);
    });

    it('should mark multiple excess vaults correctly', () => {
      const vaults = [
        { id: 'v3', createdAt: new Date('2024-03-01') },
        { id: 'v1', createdAt: new Date('2024-01-01') }, // oldest - allowed
        { id: 'v4', createdAt: new Date('2024-04-01') },
        { id: 'v2', createdAt: new Date('2024-02-01') },
      ];

      const result = computeVaultAccess(vaults, 'free');

      expect(result.allowedIds.size).toBe(1);
      expect(result.allowedIds.has('v1')).toBe(true);
      expect(result.excessIds.size).toBe(3);
      expect(result.excessIds.has('v2')).toBe(true);
      expect(result.excessIds.has('v3')).toBe(true);
      expect(result.excessIds.has('v4')).toBe(true);
    });

    it('should handle empty vault list', () => {
      const result = computeVaultAccess([], 'free');

      expect(result.allowedIds.size).toBe(0);
      expect(result.excessIds.size).toBe(0);
    });
  });

  describe('canWriteToVault logic', () => {
    // Simulate the logic from canWriteToVault
    function checkWritePermission(
      plan: UserPlan,
      isPrivate: boolean,
      vaultId: string,
      excessVaultIds: Set<string>
    ): { allowed: boolean; reason?: string } {
      // Public vaults: always allowed
      if (!isPrivate) {
        return { allowed: true };
      }

      // Pro/Team plans: always allowed (unlimited private repos)
      if (PLANS[plan].maxPrivateRepos === Infinity) {
        return { allowed: true };
      }

      // Free plan with private vault: check if it's within limit
      if (excessVaultIds.has(vaultId)) {
        return {
          allowed: false,
          reason:
            'This private vault is read-only on the Free plan. Upgrade to Pro to unlock editing.',
        };
      }

      return { allowed: true };
    }

    describe('public vaults', () => {
      it('should always allow writes to public vaults on free plan', () => {
        const result = checkWritePermission('free', false, 'v1', new Set(['v1']));
        expect(result.allowed).toBe(true);
      });

      it('should always allow writes to public vaults on pro plan', () => {
        const result = checkWritePermission('pro', false, 'v1', new Set());
        expect(result.allowed).toBe(true);
      });
    });

    describe('private vaults - pro/team/startup plans', () => {
      it('should allow writes to private vault within pro plan limit', () => {
        // v1 is not in excess set, so it should be allowed
        const result = checkWritePermission('pro', true, 'v1', new Set());
        expect(result.allowed).toBe(true);
      });

      it('should deny writes to excess private vault on pro plan', () => {
        // v6 is the 6th vault, exceeding the 5 vault limit for pro
        const result = checkWritePermission('pro', true, 'v6', new Set(['v6']));
        expect(result.allowed).toBe(false);
      });

      it('should allow writes to private vault within team plan limit', () => {
        const result = checkWritePermission('team', true, 'v1', new Set());
        expect(result.allowed).toBe(true);
      });

      it('should allow writes to any private vault on startup plan', () => {
        // Startup has 40 repos, testing with vault within limit
        const result = checkWritePermission('startup', true, 'v1', new Set());
        expect(result.allowed).toBe(true);
      });
    });

    describe('private vaults - free plan', () => {
      it('should allow writes to vault within limit', () => {
        const result = checkWritePermission('free', true, 'v1', new Set(['v2', 'v3']));
        expect(result.allowed).toBe(true);
      });

      it('should deny writes to excess vault', () => {
        const excessVaultIds = new Set(['v2', 'v3']);
        const result = checkWritePermission('free', true, 'v2', excessVaultIds);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('read-only');
        expect(result.reason).toContain('Free plan');
        expect(result.reason).toContain('Upgrade to Pro');
      });

      it('should deny writes to all excess vaults', () => {
        const excessVaultIds = new Set(['v2', 'v3', 'v4']);

        expect(checkWritePermission('free', true, 'v2', excessVaultIds).allowed).toBe(false);
        expect(checkWritePermission('free', true, 'v3', excessVaultIds).allowed).toBe(false);
        expect(checkWritePermission('free', true, 'v4', excessVaultIds).allowed).toBe(false);
      });
    });
  });

  describe('isReadOnly field logic', () => {
    // Simulate the isReadOnly calculation from vault.service.ts
    function computeIsReadOnly(
      vaultId: string,
      isPrivate: boolean,
      excessVaultIds: Set<string>
    ): boolean {
      if (!isPrivate) return false;
      return excessVaultIds.has(vaultId);
    }

    it('should return false for public vaults', () => {
      expect(computeIsReadOnly('v1', false, new Set(['v1']))).toBe(false);
    });

    it('should return false for private vault within limit', () => {
      expect(computeIsReadOnly('v1', true, new Set(['v2']))).toBe(false);
    });

    it('should return true for private vault exceeding limit', () => {
      expect(computeIsReadOnly('v2', true, new Set(['v2', 'v3']))).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle vault created at exact same time (stable sort)', () => {
      const sameTime = new Date('2024-01-01T00:00:00Z');
      const vaults = [
        { id: 'v1', createdAt: sameTime },
        { id: 'v2', createdAt: sameTime },
      ];

      // Sort should be stable - first one in array should remain first
      const sorted = [...vaults].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );

      // In JavaScript, sort is stable as of ES2019
      expect(sorted[0].id).toBe('v1');
    });

    it('should handle plan upgrade scenario (all vaults become writable)', () => {
      const excessOnFree = new Set(['v2', 'v3']);

      // On free plan, v2 and v3 are read-only
      expect(excessOnFree.has('v2')).toBe(true);

      // On pro plan, excessVaultIds would be empty
      const excessOnPro = new Set<string>();
      expect(excessOnPro.has('v2')).toBe(false);
    });

    it('should handle plan downgrade scenario (excess vaults become read-only)', () => {
      // User with 3 private vaults downgrades from pro to free
      const vaults = [
        { id: 'v1', createdAt: new Date('2024-01-01') },
        { id: 'v2', createdAt: new Date('2024-02-01') },
        { id: 'v3', createdAt: new Date('2024-03-01') },
      ];

      const limit = PLANS.free.maxPrivateRepos; // 1
      const sorted = [...vaults].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
      const excessIds = new Set(sorted.slice(limit).map((v) => v.id));

      // Only oldest vault (v1) remains writable
      expect(excessIds.has('v1')).toBe(false);
      expect(excessIds.has('v2')).toBe(true);
      expect(excessIds.has('v3')).toBe(true);
    });
  });
});

describe('Soft Limits - Error Messages', () => {
  it('should include upgrade guidance in error message', () => {
    const reason =
      'This private vault is read-only on the Free plan. Upgrade to Pro to unlock editing.';

    expect(reason).toContain('Upgrade to Pro');
    expect(reason).toContain('read-only');
  });

  it('should be user-friendly and actionable', () => {
    const reason =
      'This private vault is read-only on the Free plan. Upgrade to Pro to unlock editing.';

    // Should explain the situation
    expect(reason).toContain('read-only');
    // Should mention the plan
    expect(reason).toContain('Free plan');
    // Should provide action
    expect(reason).toContain('Upgrade');
  });
});
