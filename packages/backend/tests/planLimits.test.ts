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
        maxPrivateRepos: 1,
        maxProviders: 2,
        maxEnvironmentsPerVault: 3,
        maxSecretsPerPrivateVault: Infinity,
        maxCollaboratorsPerVault: 15,
      });
    });

    it('should define pro plan with 5 private repos and unlimited envs', () => {
      expect(PLANS.pro.maxPrivateRepos).toBe(5);
      expect(PLANS.pro.maxProviders).toBe(Infinity);
      expect(PLANS.pro.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.pro.maxSecretsPerPrivateVault).toBe(Infinity);
      expect(PLANS.pro.maxCollaboratorsPerVault).toBe(15);
    });

    it('should define team plan with 10 private repos and unlimited envs', () => {
      expect(PLANS.team.maxPrivateRepos).toBe(10);
      expect(PLANS.team.maxProviders).toBe(Infinity);
      expect(PLANS.team.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.team.maxSecretsPerPrivateVault).toBe(Infinity);
      expect(PLANS.team.maxCollaboratorsPerVault).toBe(15);
    });

    it('should define startup plan with 40 private repos and 30 collaborators', () => {
      expect(PLANS.startup.maxPrivateRepos).toBe(40);
      expect(PLANS.startup.maxProviders).toBe(Infinity);
      expect(PLANS.startup.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.startup.maxSecretsPerPrivateVault).toBe(Infinity);
      expect(PLANS.startup.maxCollaboratorsPerVault).toBe(30);
    });
  });

  describe('getPlanLimits', () => {
    it('should return correct limits for each plan', () => {
      expect(getPlanLimits('free')).toBe(PLANS.free);
      expect(getPlanLimits('pro')).toBe(PLANS.pro);
      expect(getPlanLimits('team')).toBe(PLANS.team);
      expect(getPlanLimits('startup')).toBe(PLANS.startup);
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

    it('should allow free plan first private repo', () => {
      const result = canCreateRepo('free', 0, 0, true, false);
      expect(result.allowed).toBe(true);
    });

    it('should reject free plan second private repo', () => {
      const result = canCreateRepo('free', 0, 1, true, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('1 private repo');
    });

    it('should allow free plan private org repos within limit', () => {
      // Free plan can now create private org repos, but still limited to 1 total private repo
      const result = canCreateRepo('free', 0, 0, true, true);
      expect(result.allowed).toBe(true);
    });

    it('should reject free plan second private org repo', () => {
      // Org repos count toward the same limit as personal repos
      const result = canCreateRepo('free', 0, 1, true, true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('1 private repo');
    });

    it('should allow pro plan up to 5 private repos', () => {
      const result = canCreateRepo('pro', 0, 4, true, false);
      expect(result.allowed).toBe(true);
    });

    it('should deny pro plan 6th private repo', () => {
      const result = canCreateRepo('pro', 0, 5, true, false);
      expect(result.allowed).toBe(false);
    });

    it('should allow all plans to create private org repos within their limits', () => {
      // All plans can create private org repos, limited by their maxPrivateRepos
      expect(canCreateRepo('free', 0, 0, true, true).allowed).toBe(true);
      expect(canCreateRepo('pro', 0, 0, true, true).allowed).toBe(true);
      expect(canCreateRepo('team', 0, 0, true, true).allowed).toBe(true);
      expect(canCreateRepo('startup', 0, 0, true, true).allowed).toBe(true);
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

    it('should allow pro plan unlimited providers', () => {
      const result = canConnectProvider('pro', 100);
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

    it('should allow pro plan unlimited environments', () => {
      const result = canCreateEnvironment('pro', 100);
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

    it('should allow pro plan unlimited secrets in private vault', () => {
      const result = canCreateSecret('pro', 1000, true);
      expect(result.allowed).toBe(true);
    });
  });
});
