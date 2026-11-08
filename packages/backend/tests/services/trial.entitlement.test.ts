import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A trial must not turn into a permanent Business plan.
 *
 * Scenario: start trial (plan := "business") → open org checkout (Stripe
 * customer id stored BEFORE payment) → abandon. The old read-time rule
 * "stripeCustomerId + team/business plan ⇒ paid" then granted Business forever,
 * and nothing ever calls expireTrial().
 *
 * Paid status must come from the subscription webhook, never from the mere
 * existence of a Stripe customer; an expired, unconverted trial is "free" at
 * read time whatever any background job did or didn't do.
 */

const mocks = vi.hoisted(() => ({
  usersFindFirst: vi.fn(),
  organizationsFindFirst: vi.fn(),
  organizationMembersFindMany: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    query: {
      users: { findFirst: mocks.usersFindFirst },
      organizations: { findFirst: mocks.organizationsFindFirst },
      organizationMembers: { findMany: mocks.organizationMembersFindMany },
    },
    update: vi.fn(),
  },
  organizations: { id: "id" },
  organizationMembers: { userId: "userId", orgRole: "orgRole" },
  users: { id: "id" },
}));

vi.mock("../../src/services/activity.service", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import {
  getEffectivePlanWithTrial,
  getEffectivePlanForUser,
  startTrial,
} from "../../src/services/trial.service";
import { getTrialEligibility } from "../../src/services/organization.service";

const DAY = 24 * 60 * 60 * 1000;

const baseOrg = {
  id: "org-1",
  forgeType: "github" as const,
  forgeOrgId: "1",
  login: "acme",
  displayName: null,
  avatarUrl: null,
  plan: "free" as const,
  stripeCustomerId: null as string | null,
  trialStartedAt: null as Date | null,
  trialEndsAt: null as Date | null,
  trialConvertedAt: null as Date | null,
  defaultPermissions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Trial started, checkout opened (customer created), never paid, trial over. */
const abandonedCheckoutAfterTrial = {
  ...baseOrg,
  plan: "business" as const, // written by startTrial, never reset (expireTrial is not scheduled)
  stripeCustomerId: "cus_abandoned", // written by getOrCreateOrgStripeCustomer before payment
  trialStartedAt: new Date(Date.now() - 20 * DAY),
  trialEndsAt: new Date(Date.now() - 5 * DAY),
  trialConvertedAt: null,
};

/** Trial converted by the subscription webhook (status active). */
const convertedSubscriber = {
  ...abandonedCheckoutAfterTrial,
  stripeCustomerId: "cus_paid",
  trialConvertedAt: new Date(Date.now() - 6 * DAY),
};

/** Subscribed directly, no trial: plan written by the subscription webhook. */
const directSubscriber = {
  ...baseOrg,
  plan: "team" as const,
  stripeCustomerId: "cus_team",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getEffectivePlanWithTrial", () => {
  it("is free once a trial expired without conversion, even with a Stripe customer id", () => {
    expect(getEffectivePlanWithTrial(abandonedCheckoutAfterTrial as any)).toBe("free");
  });

  it("is business during an active trial with an abandoned checkout", () => {
    const activeTrial = {
      ...abandonedCheckoutAfterTrial,
      trialEndsAt: new Date(Date.now() + 3 * DAY),
    };
    expect(getEffectivePlanWithTrial(activeTrial as any)).toBe("business");
  });

  it("keeps the subscribed plan for a converted trial", () => {
    expect(getEffectivePlanWithTrial(convertedSubscriber as any)).toBe("business");
    expect(getEffectivePlanWithTrial({ ...convertedSubscriber, plan: "team" } as any)).toBe("team");
  });

  it("keeps the subscribed plan for an org that subscribed without a trial", () => {
    expect(getEffectivePlanWithTrial(directSubscriber as any)).toBe("team");
  });

  it("is free for an org whose subscription ended (webhook reset the plan)", () => {
    expect(getEffectivePlanWithTrial({ ...convertedSubscriber, plan: "free" } as any)).toBe("free");
  });
});

describe("getEffectivePlanForUser", () => {
  it("does not inherit Business from an owned org whose trial expired after an abandoned checkout", async () => {
    mocks.usersFindFirst.mockResolvedValue({ plan: "free" });
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: abandonedCheckoutAfterTrial },
    ]);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");
  });

  it("inherits the plan of an owned org with a real subscription", async () => {
    mocks.usersFindFirst.mockResolvedValue({ plan: "free" });
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: convertedSubscriber },
    ]);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("business");
  });
});

describe("trial eligibility ignores abandoned checkouts", () => {
  it("startTrial still refuses a paid Team org that never trialed", async () => {
    mocks.organizationsFindFirst.mockResolvedValue(directSubscriber);
    const result = await startTrial({ orgId: "org-1", userId: "u-1", platform: "web" });
    expect(result).toEqual({ success: false, error: "Organization already has a paid plan" });
  });

  it("getTrialEligibility reports a converted subscriber as already paid", () => {
    expect(getTrialEligibility(convertedSubscriber as any).reason).toBe(
      "Organization already has a paid plan"
    );
  });

  it("getTrialEligibility does not call an expired, abandoned trial a paid plan", () => {
    const eligibility = getTrialEligibility(abandonedCheckoutAfterTrial as any);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("Organization has already used their trial");
  });
});
