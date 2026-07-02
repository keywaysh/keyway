import { describe, it, expect } from 'vitest';
import {
  getPlanLimits,
  canCreateRepo,
  canConnectProvider,
  canCreateEnvironment,
  canCreateSecret,
  formatLimit,
  PLANS,
} from '../src/config/plans';

describe('Plan Configuration', () => {
  describe('PLANS constant', () => {
    it('should define free plan with correct limits', () => {
      expect(PLANS.free).toEqual({
        maxPublicRepos: Infinity,
        maxPrivateRepos: 10,
        maxProviders: 2,
        maxEnvironmentsPerVault: 3,
        maxSecretsPerPrivateVault: Infinity,
      });
    });

    it('should define team plan with unlimited repos and envs', () => {
      expect(PLANS.team.maxPrivateRepos).toBe(Infinity);
      expect(PLANS.team.maxProviders).toBe(Infinity);
      expect(PLANS.team.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.team.maxSecretsPerPrivateVault).toBe(Infinity);
    });

    it('should define business plan with unlimited repos and envs', () => {
      expect(PLANS.business.maxPrivateRepos).toBe(Infinity);
      expect(PLANS.business.maxProviders).toBe(Infinity);
      expect(PLANS.business.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.business.maxSecretsPerPrivateVault).toBe(Infinity);
    });

    it('should not define a pro plan', () => {
      expect(Object.keys(PLANS)).toEqual(['free', 'team', 'business']);
    });
  });

  describe('getPlanLimits', () => {
    it('should return correct limits for each plan', () => {
      expect(getPlanLimits('free')).toBe(PLANS.free);
      expect(getPlanLimits('team')).toBe(PLANS.team);
      expect(getPlanLimits('business')).toBe(PLANS.business);
    });
  });

  describe('formatLimit', () => {
    it('should return "unlimited" for Infinity', () => {
      expect(formatLimit(Infinity)).toBe('unlimited');
    });

    it('should return number for finite values', () => {
      expect(formatLimit(1)).toBe(1);
      expect(formatLimit(20)).toBe(20);
    });
  });
});

describe('Plan Limit Checks', () => {
  describe('canCreateRepo', () => {
    it('should allow free plan to create public repos', () => {
      const result = canCreateRepo('free', 10, 0, false, false);
      expect(result.allowed).toBe(true);
    });

    it('should allow free plan up to 10 private repos', () => {
      const result = canCreateRepo('free', 0, 9, true, false);
      expect(result.allowed).toBe(true);
    });

    it('should reject free plan 11th private repo', () => {
      const result = canCreateRepo('free', 0, 10, true, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('10 private repos');
    });

    it('should allow free plan private org repos within limit', () => {
      const result = canCreateRepo('free', 0, 0, true, true);
      expect(result.allowed).toBe(true);
    });

    it('should reject free plan 11th private org repo', () => {
      // Org repos count toward the same limit as personal repos
      const result = canCreateRepo('free', 0, 10, true, true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('10 private repos');
    });

    it('should allow paid plans unlimited private repos', () => {
      expect(canCreateRepo('team', 0, 1000, true, false).allowed).toBe(true);
      expect(canCreateRepo('business', 0, 1000, true, false).allowed).toBe(true);
    });

    it('should allow all plans to create private org repos within their limits', () => {
      expect(canCreateRepo('free', 0, 0, true, true).allowed).toBe(true);
      expect(canCreateRepo('team', 0, 0, true, true).allowed).toBe(true);
      expect(canCreateRepo('business', 0, 0, true, true).allowed).toBe(true);
    });
  });

  describe('canConnectProvider', () => {
    it('should allow free plan first two providers', () => {
      expect(canConnectProvider('free', 0).allowed).toBe(true);
      expect(canConnectProvider('free', 1).allowed).toBe(true);
    });

    it('should reject free plan third provider', () => {
      const result = canConnectProvider('free', 2);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('2 provider connections');
    });

    it('should allow team plan unlimited providers', () => {
      const result = canConnectProvider('team', 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('canCreateEnvironment', () => {
    it('should allow free plan first three environments', () => {
      expect(canCreateEnvironment('free', 0).allowed).toBe(true);
      expect(canCreateEnvironment('free', 1).allowed).toBe(true);
      expect(canCreateEnvironment('free', 2).allowed).toBe(true);
    });

    it('should reject free plan fourth environment', () => {
      const result = canCreateEnvironment('free', 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('3 environments');
    });

    it('should allow team plan unlimited environments', () => {
      const result = canCreateEnvironment('team', 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('canCreateSecret', () => {
    it('should allow unlimited secrets for public vaults', () => {
      const result = canCreateSecret('free', 100, false);
      expect(result.allowed).toBe(true);
    });

    it('should allow free plan unlimited secrets in private vault', () => {
      expect(canCreateSecret('free', 0, true).allowed).toBe(true);
      expect(canCreateSecret('free', 100, true).allowed).toBe(true);
      expect(canCreateSecret('free', 1000, true).allowed).toBe(true);
    });

    it('should allow team plan unlimited secrets in private vault', () => {
      const result = canCreateSecret('team', 1000, true);
      expect(result.allowed).toBe(true);
    });
  });
});
