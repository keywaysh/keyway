import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A subscription event may only change the plan when it concerns the account's
 * CURRENT subscription.
 *
 * Scenario: subscription A stays `incomplete` (first payment never made), the
 * account pays with subscription B (active, plan team), then a day later Stripe
 * sends A → `incomplete_expired` (or deletes A). That must not drop the account
 * to free.
 *
 *  - Both: the plan is recomputed from the subscriptions Stripe holds for the
 *    customer now (one subscriptions.list per event); any entitled one keeps
 *    the account on its plan.
 *  - Users: the `subscriptions` row stores the current subscription id; a
 *    non-entitled event or a deletion for another id is ignored.
 *  - Orgs: only subscriptions carrying the org's keyway_org_id count.
 */

const mocks = vi.hoisted(() => ({
  updateOrganizationPlan: vi.fn(),
  getOrganizationById: vi.fn(),
  convertTrial: vi.fn(),
  subscriptionsList: vi.fn(),
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

import {
  handleOrgSubscriptionChange,
  handleOrgSubscriptionDeleted,
  handleWebhookEvent,
} from "../../src/services/billing.service";
import { billingDb, stripeEvent, stripeSubscription } from "../helpers/billingFakes";

const ORG = { keyway_org_id: "org-1" };
const USER = { keyway_user_id: "u-1" };
const paidOrg = { id: "org-1", login: "acme", plan: "team", trialStartedAt: null, trialConvertedAt: null };

const subscription = (id: string, status: string, metadata: Record<string, string>) =>
  stripeSubscription(id, status, "team", metadata);

/** The (non-canceled) subscriptions Stripe lists for the customer right now. */
function stripeHolds(...subs: ReturnType<typeof stripeSubscription>[]) {
  mocks.subscriptionsList.mockResolvedValue({ data: subs, has_more: false });
}

const lastOrgPlan = () => mocks.updateOrganizationPlan.mock.calls.at(-1)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  billingDb.reset();
  mocks.getOrganizationById.mockResolvedValue(paidOrg);
  mocks.convertTrial.mockResolvedValue({ success: true });
});

// ============================================================================
// Organizations
// ============================================================================

describe("org subscription events only downgrade from the current subscription", () => {
  it("keeps the plan when an abandoned subscription expires after the org paid with another one", async () => {
    stripeHolds(subscription("sub_B", "active", ORG), subscription("sub_A", "incomplete_expired", ORG));

    await handleOrgSubscriptionChange(subscription("sub_A", "incomplete_expired", ORG));

    expect(mocks.subscriptionsList).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "free");
    expect(lastOrgPlan()).toBe("team");
  });

  it("downgrades when the expiring subscription is the org's only one", async () => {
    stripeHolds(subscription("sub_A", "incomplete_expired", ORG));

    await handleOrgSubscriptionChange(subscription("sub_A", "incomplete_expired", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("does not count another org's subscription on the same customer", async () => {
    stripeHolds(subscription("sub_X", "active", { keyway_org_id: "org-2" }));

    await handleOrgSubscriptionChange(subscription("sub_A", "canceled", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("keeps the plan when an old subscription is deleted while another one is active", async () => {
    stripeHolds(subscription("sub_B", "active", ORG));

    await handleOrgSubscriptionDeleted(subscription("sub_A", "canceled", ORG));

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "free");
    expect(lastOrgPlan()).toBe("team");
  });

  it("downgrades when the org's only subscription is deleted", async () => {
    stripeHolds();

    await handleOrgSubscriptionDeleted(subscription("sub_A", "canceled", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("fails the event when Stripe can't be asked, so Stripe retries it, leaving the plan alone", async () => {
    mocks.subscriptionsList.mockRejectedValue(new Error("Stripe down"));

    await expect(handleOrgSubscriptionChange(subscription("sub_A", "unpaid", ORG))).rejects.toThrow(
      "Stripe down"
    );

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalled();
  });

  it("asks Stripe once per event, for the event's customer", async () => {
    stripeHolds(subscription("sub_B", "active", ORG));

    await handleOrgSubscriptionChange(subscription("sub_B", "active", ORG));

    expect(mocks.subscriptionsList).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionsList).toHaveBeenCalledWith({ customer: "cus_1", limit: 100 });
    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "team");
  });
});

// ============================================================================
// Users
// ============================================================================

describe("user subscription events only change the plan for the current subscription", () => {
  const userPlan = () => billingDb.users.find((u) => u.id === "u-1")?.plan;
  const storedRow = () => billingDb.subscriptions.find((s) => s.userId === "u-1");

  function given(plan: string, row?: { stripeSubscriptionId: string; status: string }) {
    billingDb.users.push({ id: "u-1", plan, billingStatus: "active" });
    if (row) {
      billingDb.subscriptions.push({ userId: "u-1", ...row });
    }
  }

  it("ignores a late incomplete_expired for an old subscription once the user paid with a new one", async () => {
    given("team", { stripeSubscriptionId: "sub_B", status: "active" });
    stripeHolds(subscription("sub_B", "active", USER), subscription("sub_A", "incomplete_expired", USER));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", subscription("sub_A", "incomplete_expired", USER))
    );

    expect(userPlan()).toBe("team");
    // B stays the stored current subscription
    expect(storedRow()).toEqual(expect.objectContaining({ stripeSubscriptionId: "sub_B", status: "active" }));
  });

  it("ignores a late non-entitled event for an old subscription even if Stripe no longer lists the current one", async () => {
    given("team", { stripeSubscriptionId: "sub_B", status: "active" });
    stripeHolds(subscription("sub_A", "incomplete_expired", USER));

    await handleWebhookEvent(
      stripeEvent("customer.subscription.updated", subscription("sub_A", "incomplete_expired", USER))
    );

    // B's own events maintain the plan
    expect(userPlan()).toBe("team");
    expect(storedRow()?.stripeSubscriptionId).toBe("sub_B");
  });

  it("ignores the deletion of an old subscription (no downgrade, current row kept)", async () => {
    given("team", { stripeSubscriptionId: "sub_B", status: "active" });
    stripeHolds(subscription("sub_B", "active", USER));

    await handleWebhookEvent(stripeEvent("customer.subscription.deleted", subscription("sub_A", "canceled", USER)));

    expect(userPlan()).toBe("team");
    expect(billingDb.writes).not.toContain("delete subscriptions");
    expect(storedRow()?.stripeSubscriptionId).toBe("sub_B");
  });

  it("still downgrades when the current subscription itself expires", async () => {
    given("team", { stripeSubscriptionId: "sub_A", status: "past_due" });
    stripeHolds(subscription("sub_A", "unpaid", USER));

    await handleWebhookEvent(stripeEvent("customer.subscription.updated", subscription("sub_A", "unpaid", USER)));

    expect(userPlan()).toBe("free");
    expect(storedRow()?.status).toBe("unpaid");
  });

  it("still downgrades when the current subscription is deleted", async () => {
    given("team", { stripeSubscriptionId: "sub_A", status: "active" });
    stripeHolds();

    await handleWebhookEvent(stripeEvent("customer.subscription.deleted", subscription("sub_A", "canceled", USER)));

    expect(userPlan()).toBe("free");
    expect(storedRow()).toBeUndefined();
  });

  it("lets a new subscription that became active replace the stored one", async () => {
    given("free", { stripeSubscriptionId: "sub_A", status: "incomplete" });
    stripeHolds(subscription("sub_A", "incomplete", USER), subscription("sub_B", "active", USER));

    await handleWebhookEvent(stripeEvent("customer.subscription.updated", subscription("sub_B", "active", USER)));

    expect(userPlan()).toBe("team");
    expect(storedRow()?.stripeSubscriptionId).toBe("sub_B");
  });

  it("applies the first event of a user with no stored subscription", async () => {
    given("team");
    stripeHolds(subscription("sub_A", "unpaid", USER));

    await handleWebhookEvent(stripeEvent("customer.subscription.updated", subscription("sub_A", "unpaid", USER)));

    expect(userPlan()).toBe("free");
  });
});
