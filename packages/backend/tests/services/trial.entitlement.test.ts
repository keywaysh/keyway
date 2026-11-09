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
  isLiveOrgAdmin: vi.fn(),
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

vi.mock("../../src/utils/orgAdmin", () => ({
  isLiveOrgAdmin: mocks.isLiveOrgAdmin,
}));

import {
  getEffectivePlanWithTrial,
  getEffectivePlanForUser,
  clearOrgOwnerVerifications,
  ORG_OWNER_VERIFICATION_TTL_MS,
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

/** A signed-in GitHub user with no paid plan of their own. */
const alice = { plan: "free", username: "alice", forgeUserId: "1001", forgeType: "github" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  clearOrgOwnerVerifications();
  mocks.isLiveOrgAdmin.mockResolvedValue(true);
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
    mocks.usersFindFirst.mockResolvedValue(alice);
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: abandonedCheckoutAfterTrial },
    ]);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");
  });

  it("inherits the plan of an owned org with a real subscription", async () => {
    mocks.usersFindFirst.mockResolvedValue(alice);
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: convertedSubscriber },
    ]);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("business");
  });
});

/**
 * Org owners get the org's tier (Business features such as Exposure). The
 * owner row is only a mirror of GitHub, and GitHub sends no webhook when an
 * admin is demoted: a removed or demoted owner must not keep Business from a
 * cached row. Each grant needs a live GitHub confirmation, trusted for a short
 * window only, and anything short of a confirmation grants nothing.
 */
describe("getEffectivePlanForUser verifies org ownership live", () => {
  beforeEach(() => {
    mocks.usersFindFirst.mockResolvedValue(alice);
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: convertedSubscriber },
    ]);
  });

  it("checks the signed-in account (immutable GitHub id) against that org", async () => {
    await getEffectivePlanForUser("u-1");

    expect(mocks.isLiveOrgAdmin).toHaveBeenCalledWith(
      convertedSubscriber,
      expect.objectContaining({ username: "alice", forgeUserId: "1001", forgeType: "github" })
    );
  });

  it("does not grant Business from a cached owner row GitHub no longer backs (removed or demoted)", async () => {
    mocks.isLiveOrgAdmin.mockResolvedValue(false);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");
  });

  it("fails closed when the live check errors", async () => {
    mocks.isLiveOrgAdmin.mockRejectedValue(new Error("GitHub down"));

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");
  });

  it("keeps the user's own plan when the org check fails", async () => {
    mocks.usersFindFirst.mockResolvedValue({ ...alice, plan: "team" });
    mocks.isLiveOrgAdmin.mockResolvedValue(false);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("team");
  });

  it("reuses a confirmation within the window: one GitHub check per user and org", async () => {
    await getEffectivePlanForUser("u-1");
    await getEffectivePlanForUser("u-1");

    expect(mocks.isLiveOrgAdmin).toHaveBeenCalledTimes(1);
  });

  it("re-checks once the window is over, so a demotion takes effect", async () => {
    vi.useFakeTimers();
    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("business");

    mocks.isLiveOrgAdmin.mockResolvedValue(false); // demoted on GitHub
    vi.advanceTimersByTime(ORG_OWNER_VERIFICATION_TTL_MS + 1);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");
    expect(mocks.isLiveOrgAdmin).toHaveBeenCalledTimes(2);
  });

  it("does not hold a refusal for the whole window (a transient failure recovers quickly)", async () => {
    vi.useFakeTimers();
    mocks.isLiveOrgAdmin.mockResolvedValueOnce(false);
    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");

    vi.advanceTimersByTime(61 * 1000);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("business");
  });

  it("does not share a confirmation between users", async () => {
    await getEffectivePlanForUser("u-1");
    mocks.isLiveOrgAdmin.mockResolvedValue(false);

    await expect(getEffectivePlanForUser("u-2")).resolves.toBe("free");
    expect(mocks.isLiveOrgAdmin).toHaveBeenCalledTimes(2);
  });

  it("makes no GitHub call when no owned org would raise the plan", async () => {
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: abandonedCheckoutAfterTrial }, // effectively free
    ]);
    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");

    mocks.usersFindFirst.mockResolvedValue({ ...alice, plan: "business" });
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: convertedSubscriber },
    ]);
    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("business");

    expect(mocks.isLiveOrgAdmin).not.toHaveBeenCalled();
  });

  it("checks the best org first and falls back to the next one GitHub confirms", async () => {
    const teamOrg = { ...directSubscriber, id: "org-team" };
    const businessOrg = { ...convertedSubscriber, id: "org-business" };
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: teamOrg },
      { orgRole: "owner", organization: businessOrg },
    ]);
    mocks.isLiveOrgAdmin.mockImplementation(async (org: { id: string }) => org.id === "org-team");

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("team");
    expect(mocks.isLiveOrgAdmin.mock.calls.map(([org]) => org.id)).toEqual([
      "org-business",
      "org-team",
    ]);
  });

  it("grants nothing from an org of another forge (GitHub ids are per-forge)", async () => {
    mocks.organizationMembersFindMany.mockResolvedValue([
      { orgRole: "owner", organization: { ...convertedSubscriber, forgeType: "gitlab" } },
    ]);

    await expect(getEffectivePlanForUser("u-1")).resolves.toBe("free");
    expect(mocks.isLiveOrgAdmin).not.toHaveBeenCalled();
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
