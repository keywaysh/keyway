import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The plan a subscription event leaves the account on is computed from the
 * subscriptions Stripe holds NOW, not from the event payload:
 *
 *  - Several entitled subscriptions (parallel checkouts: Team + Business): the
 *    plan is the highest tier among them, and ending one falls back to the
 *    next one instead of keeping the ended tier.
 *  - Out-of-order delivery: an `active` snapshot older than a cancellation or
 *    a downgrade must not restore what Stripe no longer bills.
 *  - If Stripe can't be asked, the event fails (and Stripe retries it) rather
 *    than guessing.
 */

const mocks = vi.hoisted(() => ({
  subscriptionsList: vi.fn(),
  updateOrganizationPlan: vi.fn(),
  getOrganizationById: vi.fn(),
  convertTrial: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    subscriptions = { list: mocks.subscriptionsList };
    prices = { list: vi.fn().mockResolvedValue({ data: [] }) };
  },
}));

vi.mock("../../src/config", () => ({
  config: {
    billing: { enabled: true },
    stripe: { secretKey: "sk_test_x", webhookSecret: "whsec_x" },
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  ...(await import("../helpers/billingFakes")).conditionFakes,
}));
vi.mock("../../src/db", async () => (await import("../helpers/billingFakes")).fakeDbModule);

vi.mock("../../src/services/organization.service", () => ({
  updateOrganizationPlan: mocks.updateOrganizationPlan,
  setOrganizationStripeCustomerId: vi.fn(),
  getOrganizationById: mocks.getOrganizationById,
}));

vi.mock("../../src/services/trial.service", () => ({
  convertTrial: mocks.convertTrial,
  hasHadTrial: (org: { trialStartedAt: Date | null }) => org.trialStartedAt !== null,
}));

vi.mock("../../src/services/activity.service", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/analytics", () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  AnalyticsEvents: {
    BILLING_UPGRADE: "billing_upgrade",
    BILLING_DOWNGRADE: "billing_downgrade",
    BILLING_PAYMENT_FAILED: "billing_payment_failed",
  },
}));

import { handleWebhookEvent } from "../../src/services/billing.service";
import { billingDb, stripeEvent, stripeSubscription } from "../helpers/billingFakes";

const ORG = { keyway_org_id: "org-1" };
const USER = { keyway_user_id: "u-1" };

/** The (non-canceled) subscriptions Stripe lists for the customer right now. */
function stripeHolds(...subs: ReturnType<typeof stripeSubscription>[]) {
  mocks.subscriptionsList.mockResolvedValue({ data: subs, has_more: false });
}

const lastOrgPlan = () => mocks.updateOrganizationPlan.mock.calls.at(-1)?.[1];
const userPlan = () => billingDb.users.find((u) => u.id === "u-1")?.plan;
const storedSubscriptionId = () => billingDb.subscriptions.find((s) => s.userId === "u-1")?.stripeSubscriptionId;

beforeEach(() => {
  vi.clearAllMocks();
  billingDb.reset();
  mocks.getOrganizationById.mockResolvedValue({
    id: "org-1",
    login: "acme",
    plan: "business",
    trialStartedAt: null,
    trialConvertedAt: null,
  });
  mocks.convertTrial.mockResolvedValue({ success: true });
});

// ============================================================================
// Organizations
// ============================================================================

describe("org plan = highest tier among the org's entitled subscriptions", () => {
  it("falls back to Team when Business is cancelled while Team is still active", async () => {
    stripeHolds(stripeSubscription("sub_team", "active", "team", ORG));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.deleted", stripeSubscription("sub_biz", "canceled", "business", ORG))
    );

    expect(lastOrgPlan()).toBe("team");
  });

  it("falls back to Team when Business goes unpaid while Team is still active", async () => {
    stripeHolds(
      stripeSubscription("sub_team", "active", "team", ORG),
      stripeSubscription("sub_biz", "unpaid", "business", ORG)
    );

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", stripeSubscription("sub_biz", "unpaid", "business", ORG))
    );

    expect(lastOrgPlan()).toBe("team");
  });

  it("keeps Business when a Team subscription's event arrives while Business is also active", async () => {
    stripeHolds(
      stripeSubscription("sub_biz", "active", "business", ORG),
      stripeSubscription("sub_team", "active", "team", ORG)
    );

    await handleWebhookEvent(
      stripeEvent("customer.subscription.created", stripeSubscription("sub_team", "active", "team", ORG))
    );

    expect(lastOrgPlan()).toBe("business");
  });
});

describe("org events are applied from Stripe's current state (out-of-order delivery)", () => {
  it("an `active` snapshot delivered after the cancellation does not restore the plan", async () => {
    stripeHolds(); // sub_team is canceled: Stripe no longer lists it

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", stripeSubscription("sub_team", "active", "team", ORG))
    );

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "team");
    expect(lastOrgPlan()).toBe("free");
  });

  it("a Business snapshot delivered after a downgrade to Team leaves the org on Team", async () => {
    stripeHolds(stripeSubscription("sub_a", "active", "team", ORG));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", stripeSubscription("sub_a", "active", "business", ORG))
    );

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "business");
    expect(lastOrgPlan()).toBe("team");
  });

  it("an `incomplete` snapshot of a subscription that has since become active grants its plan", async () => {
    mocks.getOrganizationById.mockResolvedValue({
      id: "org-1",
      login: "acme",
      plan: "free",
      trialStartedAt: null,
      trialConvertedAt: null,
    });
    stripeHolds(stripeSubscription("sub_a", "active", "team", ORG));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.created", stripeSubscription("sub_a", "incomplete", "team", ORG))
    );

    expect(lastOrgPlan()).toBe("team");
  });

  it("a terminal status in the payload is final even if Stripe still lists the subscription", async () => {
    stripeHolds(stripeSubscription("sub_a", "active", "team", ORG));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.deleted", stripeSubscription("sub_a", "canceled", "team", ORG))
    );

    expect(lastOrgPlan()).toBe("free");
  });

  it("fails the event (so Stripe retries it) when Stripe can't be asked, leaving the plan alone", async () => {
    mocks.subscriptionsList.mockRejectedValue(new Error("Stripe down"));

    await expect(
      handleWebhookEvent(
        stripeEvent("customer.subscription.updated", stripeSubscription("sub_a", "unpaid", "team", ORG))
      )
    ).rejects.toThrow();

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Users
// ============================================================================

describe("user plan = highest tier among the user's entitled subscriptions", () => {
  it("falls back to the remaining Team subscription when the current Business one is cancelled", async () => {
    billingDb.users.push({ id: "u-1", plan: "business", billingStatus: "active" });
    billingDb.subscriptions.push({ userId: "u-1", stripeSubscriptionId: "sub_biz", status: "active" });
    stripeHolds(stripeSubscription("sub_team", "active", "team", USER));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.deleted", stripeSubscription("sub_biz", "canceled", "business", USER))
    );

    expect(userPlan()).toBe("team");
    expect(storedSubscriptionId()).toBe("sub_team");
  });

  it("keeps Business as the current subscription when a parallel Team one becomes active", async () => {
    billingDb.users.push({ id: "u-1", plan: "business", billingStatus: "active" });
    billingDb.subscriptions.push({ userId: "u-1", stripeSubscriptionId: "sub_biz", status: "active" });
    stripeHolds(
      stripeSubscription("sub_biz", "active", "business", USER),
      stripeSubscription("sub_team", "active", "team", USER)
    );

    await handleWebhookEvent(
      stripeEvent("customer.subscription.created", stripeSubscription("sub_team", "active", "team", USER))
    );

    expect(userPlan()).toBe("business");
    expect(storedSubscriptionId()).toBe("sub_biz");
  });
});

describe("user events are applied from Stripe's current state (out-of-order delivery)", () => {
  it("an `active` snapshot delivered after the deletion does not restore the plan", async () => {
    // The deletion was processed: no stored subscription, plan free.
    billingDb.users.push({ id: "u-1", plan: "free", billingStatus: "canceled" });
    stripeHolds();

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", stripeSubscription("sub_a", "active", "team", USER))
    );

    expect(userPlan()).toBe("free");
    expect(storedSubscriptionId()).toBeUndefined();
  });

  it("a Business snapshot delivered after a downgrade to Team leaves the user on Team", async () => {
    billingDb.users.push({ id: "u-1", plan: "team", billingStatus: "active" });
    billingDb.subscriptions.push({ userId: "u-1", stripeSubscriptionId: "sub_a", status: "active" });
    stripeHolds(stripeSubscription("sub_a", "active", "team", USER));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", stripeSubscription("sub_a", "active", "business", USER))
    );

    expect(userPlan()).toBe("team");
  });

  it("an `incomplete` snapshot of a subscription that has since become active grants its plan", async () => {
    billingDb.users.push({ id: "u-1", plan: "free", billingStatus: "active" });
    stripeHolds(stripeSubscription("sub_a", "active", "team", USER));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.created", stripeSubscription("sub_a", "incomplete", "team", USER))
    );

    expect(userPlan()).toBe("team");
    expect(storedSubscriptionId()).toBe("sub_a");
  });

  it("fails the event (so Stripe retries it) when Stripe can't be asked, leaving the plan alone", async () => {
    billingDb.users.push({ id: "u-1", plan: "team", billingStatus: "active" });
    billingDb.subscriptions.push({ userId: "u-1", stripeSubscriptionId: "sub_a", status: "active" });
    mocks.subscriptionsList.mockRejectedValue(new Error("Stripe down"));

    await expect(
      handleWebhookEvent(
        stripeEvent("customer.subscription.updated", stripeSubscription("sub_a", "unpaid", "team", USER))
      )
    ).rejects.toThrow();

    expect(userPlan()).toBe("team");
  });
});
