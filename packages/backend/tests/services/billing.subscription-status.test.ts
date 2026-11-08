import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Webhook side: a paid plan is granted only while the
 * Stripe subscription is in an entitled status (active, trialing, past_due
 * grace). "incomplete" (first payment not made) grants nothing; terminal or
 * suspended statuses (unpaid, incomplete_expired, canceled, paused) drop the
 * account to free even if Stripe never sends customer.subscription.deleted.
 */

const mocks = vi.hoisted(() => ({
  updateOrganizationPlan: vi.fn(),
  getOrganizationById: vi.fn(),
  convertTrial: vi.fn(),
  selectQueue: [] as unknown[][],
  userUpdates: [] as Record<string, unknown>[],
}));

vi.mock("../../src/config", () => ({
  config: { billing: { enabled: true }, stripe: undefined },
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
        values: vi.fn(() =>
          Object.assign(Promise.resolve(undefined), {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          })
        ),
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          mocks.userUpdates.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        },
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
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

import { handleOrgSubscriptionChange, handleWebhookEvent } from "../../src/services/billing.service";

const DAY = 24 * 60 * 60 * 1000;

function subscription(status: string, metadata: Record<string, string>) {
  return {
    id: "sub_1",
    status,
    customer: "cus_1",
    cancel_at_period_end: false,
    metadata,
    items: {
      data: [
        {
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          price: { id: "price_biz_m", lookup_key: "business_month_eur", recurring: { interval: "month" } },
        },
      ],
    },
  } as any;
}

const orgNoTrial = { id: "org-1", login: "acme", trialStartedAt: null, trialConvertedAt: null };
const orgOnTrial = {
  id: "org-1",
  login: "acme",
  trialStartedAt: new Date(Date.now() - 3 * DAY),
  trialEndsAt: new Date(Date.now() + 12 * DAY),
  trialConvertedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue.length = 0;
  mocks.userUpdates.length = 0;
  mocks.getOrganizationById.mockResolvedValue(orgNoTrial);
  mocks.convertTrial.mockResolvedValue({ success: true });
});

describe("handleOrgSubscriptionChange", () => {
  it("does not grant the plan while the first payment is incomplete", async () => {
    await handleOrgSubscriptionChange(subscription("incomplete", { keyway_org_id: "org-1" }));

    expect(mocks.updateOrganizationPlan).not.toHaveBeenCalledWith("org-1", "business");
    expect(mocks.convertTrial).not.toHaveBeenCalled();
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
});

describe("user subscription webhook", () => {
  function event(status: string) {
    return {
      id: `evt_${status}`,
      type: "customer.subscription.updated",
      data: { object: subscription(status, { keyway_user_id: "u-1" }) },
    } as any;
  }

  it("drops the user to free when the subscription becomes unpaid", async () => {
    // not yet processed, stored current subscription (this one), current plan
    mocks.selectQueue.push([], [{ stripeSubscriptionId: "sub_1" }], [{ plan: "business" }]);

    await handleWebhookEvent(event("unpaid"));

    const planWrites = mocks.userUpdates.filter((u) => "plan" in u);
    expect(planWrites).toHaveLength(1);
    expect(planWrites[0].plan).toBe("free");
  });

  it("does not grant the plan while the first payment is incomplete", async () => {
    mocks.selectQueue.push([], [], [{ plan: "free" }]); // first event: no stored subscription

    await handleWebhookEvent(event("incomplete"));

    const planWrites = mocks.userUpdates.filter((u) => "plan" in u);
    expect(planWrites.every((u) => u.plan !== "business")).toBe(true);
  });

  it("grants the plan for an active subscription", async () => {
    mocks.selectQueue.push([], [], [{ plan: "free" }]);

    await handleWebhookEvent(event("active"));

    const planWrites = mocks.userUpdates.filter((u) => "plan" in u);
    expect(planWrites).toHaveLength(1);
    expect(planWrites[0].plan).toBe("business");
  });
});
