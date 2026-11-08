import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Webhook side: a paid plan is granted only while the
 * Stripe subscription is in an entitled status (active, trialing, past_due
 * grace). "incomplete" (first payment not made) grants nothing; terminal or
 * suspended statuses (unpaid, incomplete_expired, canceled, paused) drop the
 * account to free even if Stripe never sends customer.subscription.deleted.
 *
 * The status that counts is the one Stripe holds now (here: the same as the
 * event's, see billing.entitlement-sync.test.ts for out-of-order deliveries).
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

import { handleOrgSubscriptionChange, handleWebhookEvent } from "../../src/services/billing.service";
import { billingDb, stripeEvent, stripeSubscription } from "../helpers/billingFakes";

const DAY = 24 * 60 * 60 * 1000;

/** The event's subscription, which Stripe also holds in that status right now. */
function subscription(status: string, metadata: Record<string, string>) {
  const sub = stripeSubscription("sub_1", status, "business", metadata);
  // Stripe's list leaves canceled subscriptions out
  mocks.subscriptionsList.mockResolvedValue({ data: status === "canceled" ? [] : [sub], has_more: false });
  return sub;
}

const orgNoTrial = { id: "org-1", login: "acme", plan: "free", trialStartedAt: null, trialConvertedAt: null };
const orgOnTrial = {
  id: "org-1",
  login: "acme",
  plan: "business",
  trialStartedAt: new Date(Date.now() - 3 * DAY),
  trialEndsAt: new Date(Date.now() + 12 * DAY),
  trialConvertedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  billingDb.reset();
  mocks.getOrganizationById.mockResolvedValue(orgNoTrial);
  mocks.convertTrial.mockResolvedValue({ success: true });
});

describe("handleOrgSubscriptionChange", () => {
  it("does not grant the plan while the first payment is incomplete", async () => {
    await handleOrgSubscriptionChange(subscription("incomplete", { keyway_org_id: "org-1" }));

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "business");
    expect(mocks.convertTrial).not.toHaveBeenCalled();
  });

  it("leaves a Keyway trial's plan alone while the first payment is incomplete", async () => {
    mocks.getOrganizationById.mockResolvedValue(orgOnTrial);

    await handleOrgSubscriptionChange(subscription("incomplete", { keyway_org_id: "org-1" }));

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalled();
  });

  it.each(["unpaid", "incomplete_expired", "canceled", "paused"])(
    "drops the org to free when the subscription is %s",
    async (status) => {
      await handleOrgSubscriptionChange(subscription(status, { keyway_org_id: "org-1" }));

      expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
      expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "business");
    }
  );

  it.each(["active", "trialing", "past_due"])("grants the plan when the subscription is %s", async (status) => {
    await handleOrgSubscriptionChange(subscription(status, { keyway_org_id: "org-1" }));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "business");
  });

  it.each(["active", "trialing"])("converts a Keyway trial when the subscription is %s", async (status) => {
    mocks.getOrganizationById.mockResolvedValue(orgOnTrial);

    await handleOrgSubscriptionChange(subscription(status, { keyway_org_id: "org-1" }));

    expect(mocks.convertTrial).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", stripeCustomerId: "cus_1" })
    );
    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "business");
  });

  it("attributes a webhook trial conversion to no user (activity_logs.user_id references users)", async () => {
    mocks.getOrganizationById.mockResolvedValue(orgOnTrial);

    await handleOrgSubscriptionChange(subscription("active", { keyway_org_id: "org-1" }));

    expect(mocks.convertTrial).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});

describe("user subscription webhook", () => {
  const event = (status: string) =>
    stripeEvent("customer.subscription.updated", subscription(status, { keyway_user_id: "u-1" }));
  const planWrites = () => billingDb.updates.filter((u) => u.table === "users" && "plan" in u.values);

  it("drops the user to free when the subscription becomes unpaid", async () => {
    billingDb.users.push({ id: "u-1", plan: "business", billingStatus: "active" });
    billingDb.subscriptions.push({ userId: "u-1", stripeSubscriptionId: "sub_1", status: "active" });

    await handleWebhookEvent(event("unpaid"));

    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0].values.plan).toBe("free");
  });

  it("does not grant the plan while the first payment is incomplete", async () => {
    billingDb.users.push({ id: "u-1", plan: "free", billingStatus: "active" }); // first event: no stored subscription

    await handleWebhookEvent(event("incomplete"));

    expect(planWrites().every((u) => u.values.plan !== "business")).toBe(true);
  });

  it("grants the plan for an active subscription", async () => {
    billingDb.users.push({ id: "u-1", plan: "free", billingStatus: "active" });

    await handleWebhookEvent(event("active"));

    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0].values.plan).toBe("business");
  });
});
