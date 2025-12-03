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
        maxProviders: 1,
        maxEnvironmentsPerVault: 2,
        maxSecretsPerPrivateVault: 20,
      });
    });

    it('should define pro plan with unlimited values', () => {
      expect(PLANS.pro.maxPrivateRepos).toBe(Infinity);
      expect(PLANS.pro.maxProviders).toBe(Infinity);
      expect(PLANS.pro.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.pro.maxSecretsPerPrivateVault).toBe(Infinity);
    });

    it('should define team plan with unlimited values', () => {
      expect(PLANS.team.maxPrivateRepos).toBe(Infinity);
      expect(PLANS.team.maxProviders).toBe(Infinity);
      expect(PLANS.team.maxEnvironmentsPerVault).toBe(Infinity);
      expect(PLANS.team.maxSecretsPerPrivateVault).toBe(Infinity);
    });
  });

  describe('getPlanLimits', () => {
    it('should return correct limits for each plan', () => {
      expect(getPlanLimits('free')).toBe(PLANS.free);
      expect(getPlanLimits('pro')).toBe(PLANS.pro);
      expect(getPlanLimits('team')).toBe(PLANS.team);
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

    it('should block private org repos on free plan', () => {
      const result = canCreateRepo('free', 0, 0, true, true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Team plan');
    });

    it('should allow pro plan unlimited private repos', () => {
      const result = canCreateRepo('pro', 0, 100, true, false);
      expect(result.allowed).toBe(true);
    });

    it('should allow team plan private org repos', () => {
      const result = canCreateRepo('team', 0, 0, true, true);
      expect(result.allowed).toBe(true);
    });
  });

  describe('canConnectProvider', () => {
    it('should allow free plan first provider', () => {
      const result = canConnectProvider('free', 0);
      expect(result.allowed).toBe(true);
    });

    it('should reject free plan second provider', () => {
      const result = canConnectProvider('free', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('1 provider connection');
    });

    it('should allow pro plan unlimited providers', () => {
      const result = canConnectProvider('pro', 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('canCreateEnvironment', () => {
    it('should allow free plan first two environments', () => {
      expect(canCreateEnvironment('free', 0).allowed).toBe(true);
      expect(canCreateEnvironment('free', 1).allowed).toBe(true);
    });

    it('should reject free plan third environment', () => {
      const result = canCreateEnvironment('free', 2);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('2 environments');
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

    it('should allow free plan first 20 secrets in private vault', () => {
      expect(canCreateSecret('free', 0, true).allowed).toBe(true);
      expect(canCreateSecret('free', 19, true).allowed).toBe(true);
    });

    it('should reject free plan 21st secret in private vault', () => {
      const result = canCreateSecret('free', 20, true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('20 secrets');
    });

    it('should allow pro plan unlimited secrets in private vault', () => {
      const result = canCreateSecret('pro', 1000, true);
      expect(result.allowed).toBe(true);
    });
  });
});
