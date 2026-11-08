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
 *  - Users: the `subscriptions` row stores the current subscription id; a
 *    non-entitled event or a deletion for another id is ignored.
 *  - Orgs: no subscription id is stored, so before an event lowers the plan
 *    Stripe is asked whether the customer has ANOTHER entitled subscription for
 *    the org; if so the plan is kept.
 */

const mocks = vi.hoisted(() => ({
  updateOrganizationPlan: vi.fn(),
  getOrganizationById: vi.fn(),
  convertTrial: vi.fn(),
  subscriptionsList: vi.fn(),
  selectQueue: [] as unknown[][],
  userUpdates: [] as Record<string, unknown>[],
  subscriptionUpserts: [] as Record<string, unknown>[],
  deletes: 0,
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

vi.mock("../../src/db", () => {
  const chainSelect = () => ({
    from: () => ({
      where: () => ({
        limit: async () => mocks.selectQueue.shift() ?? [],
      }),
    }),
  });
  return {
    db: {
      select: vi.fn(chainSelect),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          mocks.subscriptionUpserts.push(values);
          return Object.assign(Promise.resolve(undefined), {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          });
        }),
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          mocks.userUpdates.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        },
      })),
      delete: vi.fn(() => {
        mocks.deletes += 1;
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    },
    users: { id: "id", plan: "plan", stripeCustomerId: "stripeCustomerId" },
    subscriptions: { userId: "userId" },
    stripeWebhookEvents: { id: "id", stripeEventId: "stripeEventId" },
    organizations: { id: "id", stripeCustomerId: "stripeCustomerId" },
  };
});

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

function subscription(id: string, status: string, metadata: Record<string, string>) {
  return {
    id,
    status,
    customer: "cus_1",
    cancel_at_period_end: false,
    metadata,
    items: {
      data: [
        {
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          price: { id: "price_team_m", lookup_key: "team_month_eur", recurring: { interval: "month" } },
        },
      ],
    },
  } as any;
}

const ORG = { keyway_org_id: "org-1" };
const USER = { keyway_user_id: "u-1" };
const paidOrg = { id: "org-1", login: "acme", plan: "team", trialStartedAt: null, trialConvertedAt: null };

function stripeLists(...subs: Array<{ id: string; status: string; metadata?: Record<string, string> }>) {
  mocks.subscriptionsList.mockResolvedValue({
    data: subs.map((s) => ({ metadata: ORG, ...s })),
    has_more: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue.length = 0;
  mocks.userUpdates.length = 0;
  mocks.subscriptionUpserts.length = 0;
  mocks.deletes = 0;
  mocks.getOrganizationById.mockResolvedValue(paidOrg);
  mocks.convertTrial.mockResolvedValue({ success: true });
});

// ============================================================================
// Organizations
// ============================================================================

describe("org subscription events only downgrade from the current subscription", () => {
  it("keeps the plan when an abandoned subscription expires after the org paid with another one", async () => {
    stripeLists({ id: "sub_B", status: "active" }, { id: "sub_A", status: "incomplete_expired" });

    await handleOrgSubscriptionChange(subscription("sub_A", "incomplete_expired", ORG));

    expect(mocks.subscriptionsList).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "free");
  });

  it("downgrades when the expiring subscription is the org's only one", async () => {
    stripeLists({ id: "sub_A", status: "incomplete_expired" });

    await handleOrgSubscriptionChange(subscription("sub_A", "incomplete_expired", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("does not count another org's subscription on the same customer", async () => {
    stripeLists({ id: "sub_X", status: "active", metadata: { keyway_org_id: "org-2" } });

    await handleOrgSubscriptionChange(subscription("sub_A", "canceled", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("keeps the plan when an old subscription is deleted while another one is active", async () => {
    stripeLists({ id: "sub_B", status: "active" });

    await handleOrgSubscriptionDeleted(subscription("sub_A", "canceled", ORG));

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "free");
  });

  it("downgrades when the org's only subscription is deleted", async () => {
    stripeLists();

    await handleOrgSubscriptionDeleted(subscription("sub_A", "canceled", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("applies the downgrade when Stripe can't be asked (fails closed on entitlement)", async () => {
    mocks.subscriptionsList.mockRejectedValue(new Error("Stripe down"));

    await handleOrgSubscriptionChange(subscription("sub_A", "unpaid", ORG));

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
  });

  it("does not ask Stripe for an event that does not lower the plan", async () => {
    await handleOrgSubscriptionChange(subscription("sub_B", "active", ORG));

    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "team");
  });
});

// ============================================================================
// Users
// ============================================================================

describe("user subscription events only change the plan for the current subscription", () => {
  function event(type: string, sub: ReturnType<typeof subscription>) {
    return { id: `evt_${sub.id}_${sub.status}`, type, data: { object: sub } } as any;
  }
  const planWrites = () => mocks.userUpdates.filter((u) => "plan" in u);
  // db.insert also records the webhook event id (idempotency): keep subscription rows only.
  const subscriptionRows = () => mocks.subscriptionUpserts.filter((v) => "stripeSubscriptionId" in v);

  it("ignores a late incomplete_expired for an old subscription once the user paid with a new one", async () => {
    // not yet processed; stored current subscription is B; current plan team
    mocks.selectQueue.push([], [{ stripeSubscriptionId: "sub_B", status: "active" }], [{ plan: "team" }]);

    await handleWebhookEvent(
      event("customer.subscription.updated", subscription("sub_A", "incomplete_expired", USER))
    );

    expect(planWrites()).toHaveLength(0);
    // B stays the stored current subscription
    expect(subscriptionRows()).toHaveLength(0);
  });

  it("ignores the deletion of an old subscription (no downgrade, current row kept)", async () => {
    mocks.selectQueue.push([], [{ stripeSubscriptionId: "sub_B", status: "active" }], [{ plan: "team" }]);

    await handleWebhookEvent(event("customer.subscription.deleted", subscription("sub_A", "canceled", USER)));

    expect(planWrites()).toHaveLength(0);
    expect(mocks.deletes).toBe(0);
  });

  it("still downgrades when the current subscription itself expires", async () => {
    mocks.selectQueue.push([], [{ stripeSubscriptionId: "sub_A", status: "past_due" }], [{ plan: "team" }]);

    await handleWebhookEvent(event("customer.subscription.updated", subscription("sub_A", "unpaid", USER)));

    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0].plan).toBe("free");
  });

  it("still downgrades when the current subscription is deleted", async () => {
    mocks.selectQueue.push([], [{ stripeSubscriptionId: "sub_A", status: "active" }], [{ plan: "team" }]);

    await handleWebhookEvent(event("customer.subscription.deleted", subscription("sub_A", "canceled", USER)));

    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0].plan).toBe("free");
    expect(mocks.deletes).toBe(1);
  });

  it("lets a new subscription that became active replace the stored one", async () => {
    mocks.selectQueue.push([], [{ stripeSubscriptionId: "sub_A", status: "incomplete" }], [{ plan: "free" }]);

    await handleWebhookEvent(event("customer.subscription.updated", subscription("sub_B", "active", USER)));

    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0].plan).toBe("team");
    expect(subscriptionRows()).toEqual([expect.objectContaining({ stripeSubscriptionId: "sub_B" })]);
  });

  it("applies the first event of a user with no stored subscription", async () => {
    mocks.selectQueue.push([], [], [{ plan: "team" }]);

    await handleWebhookEvent(event("customer.subscription.updated", subscription("sub_A", "unpaid", USER)));

    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0].plan).toBe("free");
  });
});
