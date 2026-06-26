import { describe, it, expect } from 'vitest';
import { PLANS, getPlanLimits, canCreateRepo, formatLimit, planRank, hasExposureAccess } from '../src/config/plans';
import { PlanLimitError } from '../src/lib';
import type { UserPlan } from '../src/db/schema';

describe('Plan hierarchy & feature gating', () => {
  describe('planRank', () => {
    it('should order plans free < pro < team < business', () => {
      expect(planRank('free')).toBeLessThan(planRank('pro'));
      expect(planRank('pro')).toBeLessThan(planRank('team'));
      expect(planRank('team')).toBeLessThan(planRank('business'));
    });
  });

  describe('hasExposureAccess (security-critical gate for secret access tracking)', () => {
    it('should grant access ONLY to the top tier (business)', () => {
      expect(hasExposureAccess('business')).toBe(true);
    });

    it('should deny all lower tiers (free, pro, team)', () => {
      expect(hasExposureAccess('free')).toBe(false);
      expect(hasExposureAccess('pro')).toBe(false);
      expect(hasExposureAccess('team')).toBe(false);
    });

    it('should fail closed for every non-business plan', () => {
      const plans: UserPlan[] = ['free', 'pro', 'team', 'business'];
      plans.forEach((plan) => {
        expect(hasExposureAccess(plan)).toBe(plan === 'business');
      });
    });
  });
});

describe('Plans Configuration', () => {
  describe('PLANS constant', () => {
    it('should define free plan with 1 private repo limit', () => {
      expect(PLANS.free.maxPrivateRepos).toBe(1);
      expect(PLANS.free.maxPublicRepos).toBe(Infinity);
    });

    it('should define pro plan with 10 private repos', () => {
      expect(PLANS.pro.maxPrivateRepos).toBe(10);
      expect(PLANS.pro.maxPublicRepos).toBe(Infinity);
    });

    it('should define team plan with 20 private repos', () => {
      expect(PLANS.team.maxPrivateRepos).toBe(20);
      expect(PLANS.team.maxPublicRepos).toBe(Infinity);
    });

    it('should define business plan with 50 private repos', () => {
      expect(PLANS.business.maxPrivateRepos).toBe(50);
      expect(PLANS.business.maxPublicRepos).toBe(Infinity);
    });

    it('should have all plan types defined', () => {
      const planTypes: UserPlan[] = ['free', 'pro', 'team', 'business'];
      planTypes.forEach((plan) => {
        expect(PLANS[plan]).toBeDefined();
        expect(PLANS[plan].maxPublicRepos).toBeDefined();
        expect(PLANS[plan].maxPrivateRepos).toBeDefined();
      });
    });
  });

  describe('getPlanLimits', () => {
    it('should return correct limits for free plan', () => {
      const limits = getPlanLimits('free');
      expect(limits.maxPrivateRepos).toBe(1);
      expect(limits.maxPublicRepos).toBe(Infinity);
    });

    it('should return correct limits for pro plan', () => {
      const limits = getPlanLimits('pro');
      expect(limits.maxPrivateRepos).toBe(10);
      expect(limits.maxPublicRepos).toBe(Infinity);
    });

    it('should return correct limits for team plan', () => {
      const limits = getPlanLimits('team');
      expect(limits.maxPrivateRepos).toBe(20);
      expect(limits.maxPublicRepos).toBe(Infinity);
    });

    it('should return correct limits for business plan', () => {
      const limits = getPlanLimits('business');
      expect(limits.maxPrivateRepos).toBe(50);
      expect(limits.maxPublicRepos).toBe(Infinity);
    });
  });

  describe('formatLimit', () => {
    it('should return "unlimited" for Infinity', () => {
      expect(formatLimit(Infinity)).toBe('unlimited');
    });

    it('should return the number for finite values', () => {
      expect(formatLimit(1)).toBe(1);
      expect(formatLimit(5)).toBe(5);
      expect(formatLimit(0)).toBe(0);
      expect(formatLimit(100)).toBe(100);
    });
  });

  describe('canCreateRepo', () => {
    describe('free plan', () => {
      it('should allow first private repo', () => {
        const result = canCreateRepo('free', 0, 0, true);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should deny second private repo', () => {
        const result = canCreateRepo('free', 0, 1, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('free plan allows 1 private repo');
        expect(result.reason).toContain('Upgrade');
      });

      it('should deny third private repo', () => {
        const result = canCreateRepo('free', 5, 2, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('free plan');
      });

      it('should always allow public repos', () => {
        // Even with many public repos
        const result1 = canCreateRepo('free', 0, 0, false);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('free', 100, 0, false);
        expect(result2.allowed).toBe(true);

        const result3 = canCreateRepo('free', 1000, 1, false);
        expect(result3.allowed).toBe(true);
      });

      it('should allow public repos even at private limit', () => {
        const result = canCreateRepo('free', 10, 1, false);
        expect(result.allowed).toBe(true);
      });
    });

    describe('pro plan', () => {
      it('should allow up to 10 private repos', () => {
        const result1 = canCreateRepo('pro', 0, 0, true);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('pro', 0, 9, true);
        expect(result2.allowed).toBe(true);
      });

      it('should deny 11th private repo', () => {
        const result = canCreateRepo('pro', 0, 10, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('pro plan allows 10 private repos');
      });

      it('should allow unlimited public repos', () => {
        const result1 = canCreateRepo('pro', 0, 0, false);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('pro', 100, 0, false);
        expect(result2.allowed).toBe(true);
      });
    });

    describe('team plan', () => {
      it('should allow up to 20 private repos', () => {
        const result1 = canCreateRepo('team', 0, 0, true);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('team', 0, 19, true);
        expect(result2.allowed).toBe(true);
      });

      it('should deny 21st private repo', () => {
        const result = canCreateRepo('team', 0, 20, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('team plan allows 20 private repos');
      });

      it('should allow unlimited public repos', () => {
        const result1 = canCreateRepo('team', 0, 0, false);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('team', 500, 0, false);
        expect(result2.allowed).toBe(true);
      });
    });

    describe('business plan', () => {
      it('should allow up to 50 private repos', () => {
        const result1 = canCreateRepo('business', 0, 0, true);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('business', 0, 49, true);
        expect(result2.allowed).toBe(true);
      });

      it('should deny 51st private repo', () => {
        const result = canCreateRepo('business', 0, 50, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('business plan allows 50 private repos');
      });

      it('should allow unlimited public repos', () => {
        const result1 = canCreateRepo('business', 0, 0, false);
        expect(result1.allowed).toBe(true);

        const result2 = canCreateRepo('business', 500, 0, false);
        expect(result2.allowed).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle exactly at limit', () => {
        // At 1 private repo, should deny
        const result = canCreateRepo('free', 0, 1, true);
        expect(result.allowed).toBe(false);
      });

      it('should handle zero usage', () => {
        const result = canCreateRepo('free', 0, 0, true);
        expect(result.allowed).toBe(true);
      });
    });
  });
});

describe('Plan limit error messages', () => {
  it('should provide upgrade guidance in denial reason', () => {
    const result = canCreateRepo('free', 0, 1, true);
    expect(result.reason).toContain('Upgrade');
  });

  it('should mention the plan name in denial reason', () => {
    const result = canCreateRepo('free', 0, 1, true);
    expect(result.reason).toContain('free');
  });

  it('should mention the limit in denial reason', () => {
    const result = canCreateRepo('free', 0, 1, true);
    expect(result.reason).toContain('1 private repo');
  });
});

describe('PlanLimitError (RFC 7807)', () => {
  it('should have correct error type', () => {
    const error = new PlanLimitError('Test message');
    expect(error.type).toBe('https://api.keyway.sh/errors/plan-limit-reached');
  });

  it('should have 403 status', () => {
    const error = new PlanLimitError('Test message');
    expect(error.status).toBe(403);
  });

  it('should include default upgrade URL', () => {
    const error = new PlanLimitError('Test message');
    expect(error.upgradeUrl).toBe('https://keyway.sh/upgrade');
  });

  it('should allow custom upgrade URL', () => {
    const error = new PlanLimitError('Test message', 'https://custom.url/upgrade');
    expect(error.upgradeUrl).toBe('https://custom.url/upgrade');
  });

  it('should serialize to RFC 7807 Problem Details with upgradeUrl', () => {
    const error = new PlanLimitError('Your plan limit reached');
    const problemDetails = error.toProblemDetails('test-trace-id');

    expect(problemDetails.type).toBe('https://api.keyway.sh/errors/plan-limit-reached');
    expect(problemDetails.title).toBe('Plan Limit Reached');
    expect(problemDetails.status).toBe(403);
    expect(problemDetails.detail).toBe('Your plan limit reached');
    expect(problemDetails.upgradeUrl).toBe('https://keyway.sh/upgrade');
  });

  it('should extend Error', () => {
    const error = new PlanLimitError('Test');
    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeDefined();
  });

  it('should work with canCreateRepo denial', () => {
    const result = canCreateRepo('free', 0, 1, true);
    if (!result.allowed) {
      const error = new PlanLimitError(result.reason!);
      expect(error.detail).toContain('free plan');
      expect(error.type).toBe('https://api.keyway.sh/errors/plan-limit-reached');
    }
  });
});
