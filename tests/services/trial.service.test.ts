import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockOrganization,
  mockOrgOnTrial,
  mockOrgExpiredTrial,
  mockOrgPaid,
  mockUser,
} from '../helpers/mocks';

// Mock the database
vi.mock('../../src/db', () => {
  const mockDbQuery = {
    organizations: {
      findFirst: vi.fn(),
    },
  };

  return {
    db: {
      query: mockDbQuery,
      update: vi.fn(),
      insert: vi.fn(),
    },
    organizations: { id: 'id' },
    activityLogs: { id: 'id' },
  };
});

// Mock activity service
vi.mock('../../src/services/activity.service', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import {
  TRIAL_DURATION_DAYS,
  getTrialInfo,
  isTrialActive,
  isTrialExpired,
  hasHadTrial,
  startTrial,
  convertTrial,
  expireTrial,
  getEffectivePlanWithTrial,
} from '../../src/services/trial.service';
import { db } from '../../src/db';
import { logActivity } from '../../src/services/activity.service';

describe('TrialService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Constants
  // ==========================================================================

  describe('TRIAL_DURATION_DAYS', () => {
    it('should be 15 days', () => {
      expect(TRIAL_DURATION_DAYS).toBe(15);
    });
  });

  // ==========================================================================
  // getTrialInfo
  // ==========================================================================

  describe('getTrialInfo', () => {
    it('should return "none" status for org without trial', () => {
      const result = getTrialInfo(mockOrganization as any);

      expect(result).toEqual({
        status: 'none',
        startedAt: null,
        endsAt: null,
        convertedAt: null,
        daysRemaining: null,
      });
    });

    it('should return "active" status for org on active trial', () => {
      const result = getTrialInfo(mockOrgOnTrial as any);

      expect(result.status).toBe('active');
      expect(result.startedAt).toEqual(mockOrgOnTrial.trialStartedAt);
      expect(result.endsAt).toEqual(mockOrgOnTrial.trialEndsAt);
      expect(result.convertedAt).toBeNull();
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.daysRemaining).toBeLessThanOrEqual(10);
    });

    it('should return "expired" status for org with expired trial', () => {
      const result = getTrialInfo(mockOrgExpiredTrial as any);

      expect(result.status).toBe('expired');
      expect(result.startedAt).toEqual(mockOrgExpiredTrial.trialStartedAt);
      expect(result.endsAt).toEqual(mockOrgExpiredTrial.trialEndsAt);
      expect(result.convertedAt).toBeNull();
      expect(result.daysRemaining).toBeNull();
    });

    it('should return "converted" status for org with converted trial', () => {
      const result = getTrialInfo(mockOrgPaid as any);

      expect(result.status).toBe('converted');
      expect(result.startedAt).toEqual(mockOrgPaid.trialStartedAt);
      expect(result.endsAt).toEqual(mockOrgPaid.trialEndsAt);
      expect(result.convertedAt).toEqual(mockOrgPaid.trialConvertedAt);
      expect(result.daysRemaining).toBeNull();
    });

    it('should calculate days remaining correctly', () => {
      const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const org = {
        ...mockOrganization,
        trialStartedAt: new Date(),
        trialEndsAt: fiveDaysFromNow,
      };

      const result = getTrialInfo(org as any);

      expect(result.daysRemaining).toBe(5);
    });
  });

  // ==========================================================================
  // Helper functions
  // ==========================================================================

  describe('isTrialActive', () => {
    it('should return true for org on active trial', () => {
      expect(isTrialActive(mockOrgOnTrial as any)).toBe(true);
    });

    it('should return false for org without trial', () => {
      expect(isTrialActive(mockOrganization as any)).toBe(false);
    });

    it('should return false for org with expired trial', () => {
      expect(isTrialActive(mockOrgExpiredTrial as any)).toBe(false);
    });

    it('should return false for converted trial', () => {
      expect(isTrialActive(mockOrgPaid as any)).toBe(false);
    });
  });

  describe('isTrialExpired', () => {
    it('should return true for org with expired trial', () => {
      expect(isTrialExpired(mockOrgExpiredTrial as any)).toBe(true);
    });

    it('should return false for org on active trial', () => {
      expect(isTrialExpired(mockOrgOnTrial as any)).toBe(false);
    });

    it('should return false for org without trial', () => {
      expect(isTrialExpired(mockOrganization as any)).toBe(false);
    });

    it('should return false for converted trial', () => {
      expect(isTrialExpired(mockOrgPaid as any)).toBe(false);
    });
  });

  describe('hasHadTrial', () => {
    it('should return true for org that had a trial', () => {
      expect(hasHadTrial(mockOrgOnTrial as any)).toBe(true);
      expect(hasHadTrial(mockOrgExpiredTrial as any)).toBe(true);
      expect(hasHadTrial(mockOrgPaid as any)).toBe(true);
    });

    it('should return false for org without trial', () => {
      expect(hasHadTrial(mockOrganization as any)).toBe(false);
    });
  });

  // ==========================================================================
  // startTrial
  // ==========================================================================

  describe('startTrial', () => {
    it('should start a trial for eligible organization', async () => {
      const updatedOrg = {
        ...mockOrganization,
        plan: 'team',
        trialStartedAt: new Date(),
        trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      };

      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrganization);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedOrg]),
          }),
        }),
      });

      const result = await startTrial({
        orgId: mockOrganization.id,
        userId: mockUser.id,
        platform: 'web',
      });

      expect(result.success).toBe(true);
      expect(result.organization).toBeDefined();
      expect(result.organization!.plan).toBe('team');
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          action: 'org_trial_started',
          platform: 'web',
        })
      );
    });

    it('should fail if organization not found', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(null);

      const result = await startTrial({
        orgId: 'non-existent',
        userId: mockUser.id,
        platform: 'web',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization not found');
    });

    it('should fail if organization already has paid Team plan', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgPaid);

      const result = await startTrial({
        orgId: mockOrgPaid.id,
        userId: mockUser.id,
        platform: 'web',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization already has a paid Team plan');
    });

    it('should fail if organization already had a trial', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgExpiredTrial);

      const result = await startTrial({
        orgId: mockOrgExpiredTrial.id,
        userId: mockUser.id,
        platform: 'web',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization has already used their trial');
    });

    it('should allow custom trial duration', async () => {
      const customDays = 30;
      const updatedOrg = {
        ...mockOrganization,
        plan: 'team',
        trialStartedAt: new Date(),
        trialEndsAt: new Date(Date.now() + customDays * 24 * 60 * 60 * 1000),
      };

      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrganization);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedOrg]),
          }),
        }),
      });

      const result = await startTrial({
        orgId: mockOrganization.id,
        userId: mockUser.id,
        platform: 'web',
        durationDays: customDays,
      });

      expect(result.success).toBe(true);
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            trialDurationDays: customDays,
          }),
        })
      );
    });
  });

  // ==========================================================================
  // convertTrial
  // ==========================================================================

  describe('convertTrial', () => {
    it('should convert trial to paid subscription', async () => {
      const convertedOrg = {
        ...mockOrgOnTrial,
        stripeCustomerId: 'cus_test123',
        trialConvertedAt: new Date(),
      };

      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgOnTrial);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([convertedOrg]),
          }),
        }),
      });

      const result = await convertTrial({
        orgId: mockOrgOnTrial.id,
        userId: mockUser.id,
        platform: 'web',
        stripeCustomerId: 'cus_test123',
      });

      expect(result.success).toBe(true);
      expect(result.organization).toBeDefined();
      expect(result.organization!.stripeCustomerId).toBe('cus_test123');
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          action: 'org_trial_converted',
          platform: 'web',
        })
      );
    });

    it('should fail if organization not found', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(null);

      const result = await convertTrial({
        orgId: 'non-existent',
        userId: mockUser.id,
        platform: 'web',
        stripeCustomerId: 'cus_test123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization not found');
    });

    it('should fail if organization is not on trial', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrganization);

      const result = await convertTrial({
        orgId: mockOrganization.id,
        userId: mockUser.id,
        platform: 'web',
        stripeCustomerId: 'cus_test123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization is not on a trial');
    });

    it('should fail if trial already converted', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgPaid);

      const result = await convertTrial({
        orgId: mockOrgPaid.id,
        userId: mockUser.id,
        platform: 'web',
        stripeCustomerId: 'cus_test123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Trial has already been converted');
    });
  });

  // ==========================================================================
  // expireTrial
  // ==========================================================================

  describe('expireTrial', () => {
    it('should expire trial and set plan to free', async () => {
      const expiredOrg = {
        ...mockOrgOnTrial,
        plan: 'free',
      };

      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgOnTrial);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([expiredOrg]),
          }),
        }),
      });

      const result = await expireTrial({
        orgId: mockOrgOnTrial.id,
      });

      expect(result.success).toBe(true);
      expect(result.organization).toBeDefined();
      expect(result.organization!.plan).toBe('free');
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org_trial_expired',
        })
      );
    });

    it('should fail if organization not found', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(null);

      const result = await expireTrial({
        orgId: 'non-existent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization not found');
    });

    it('should fail if organization is not on trial', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrganization);

      const result = await expireTrial({
        orgId: mockOrganization.id,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Organization is not on a trial');
    });

    it('should fail if trial already converted to paid', async () => {
      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgPaid);

      const result = await expireTrial({
        orgId: mockOrgPaid.id,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Trial has already been converted to paid');
    });

    it('should include custom reason in activity log', async () => {
      const expiredOrg = {
        ...mockOrgOnTrial,
        plan: 'free',
      };

      (db.query.organizations.findFirst as any).mockResolvedValue(mockOrgOnTrial);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([expiredOrg]),
          }),
        }),
      });

      await expireTrial({
        orgId: mockOrgOnTrial.id,
        reason: 'Manual expiration by admin',
      });

      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'Manual expiration by admin',
          }),
        })
      );
    });
  });

  // ==========================================================================
  // getEffectivePlanWithTrial
  // ==========================================================================

  describe('getEffectivePlanWithTrial', () => {
    it('should return "team" for paid organization', () => {
      expect(getEffectivePlanWithTrial(mockOrgPaid as any)).toBe('team');
    });

    it('should return "team" for org on active trial', () => {
      expect(getEffectivePlanWithTrial(mockOrgOnTrial as any)).toBe('team');
    });

    it('should return "free" for org with expired trial', () => {
      expect(getEffectivePlanWithTrial(mockOrgExpiredTrial as any)).toBe('free');
    });

    it('should return actual plan for org without trial', () => {
      expect(getEffectivePlanWithTrial(mockOrganization as any)).toBe('free');
    });

    it('should return actual plan for converted trial', () => {
      expect(getEffectivePlanWithTrial(mockOrgPaid as any)).toBe('team');
    });

    it('should prioritize paid status over trial', () => {
      // Org with Stripe customer ID should be considered paid even if trial dates exist
      const paidWithTrialDates = {
        ...mockOrganization,
        plan: 'team' as const,
        stripeCustomerId: 'cus_test123',
        trialStartedAt: new Date(),
        trialEndsAt: new Date(Date.now() - 1000), // Expired
        trialConvertedAt: null, // Not marked as converted
      };

      expect(getEffectivePlanWithTrial(paidWithTrialDates as any)).toBe('team');
    });
  });
});
