import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * createOrgCheckoutSession refuses a new checkout while the org's Stripe
 * customer already has a subscription that grants a plan (active, trialing or
 * past_due), not only an `active` one: a second checkout would give the org
 * two parallel subscriptions.
 */

const mocks = vi.hoisted(() => ({
  stripeSubscriptions: [] as Array<{ id: string; status: string }>,
  subscriptionsList: vi.fn(),
  checkoutCreate: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    subscriptions = { list: mocks.subscriptionsList };
    prices = {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: "price_team_m", lookup_key: "team_month_eur", unit_amount: 900, currency: "eur", recurring: { interval: "month" } },
          { id: "price_team_y", lookup_key: "team_year_eur", unit_amount: 9000, currency: "eur", recurring: { interval: "year" } },
          { id: "price_business_m", lookup_key: "business_month_eur", unit_amount: 2900, currency: "eur", recurring: { interval: "month" } },
          { id: "price_business_y", lookup_key: "business_year_eur", unit_amount: 29000, currency: "eur", recurring: { interval: "year" } },
        ],
      }),
    };
    customers = { create: vi.fn() };
    checkout = { sessions: { create: mocks.checkoutCreate } };
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
  updateOrganizationPlan: vi.fn(),
  setOrganizationStripeCustomerId: vi.fn(),
  getOrganizationById: vi.fn(),
}));

vi.mock("../../src/services/trial.service", () => ({
  convertTrial: vi.fn(),
  hasHadTrial: vi.fn(),
}));

vi.mock("../../src/services/activity.service", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../../src/utils/analytics", () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  AnalyticsEvents: {},
}));

import { createOrgCheckoutSession } from "../../src/services/billing.service";
import { billingDb } from "../helpers/billingFakes";

function checkout() {
  return createOrgCheckoutSession(
    "org-1",
    "acme",
    "owner@acme.test",
    "price_business_m",
    "https://app.keyway.sh/ok",
    "https://app.keyway.sh/cancel"
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  billingDb.reset();
  billingDb.organizations.push({ id: "org-1", stripeCustomerId: "cus_1" });
  mocks.stripeSubscriptions = [];
  // Honour Stripe's status filter: none = every subscription that is not canceled.
  mocks.subscriptionsList.mockImplementation(async ({ status }: { status?: string }) => ({
    data: mocks.stripeSubscriptions.filter((s) =>
      status === undefined ? s.status !== "canceled" : status === "all" || s.status === status
    ),
    has_more: false,
  }));
  mocks.checkoutCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/1" });
});

describe("createOrgCheckoutSession", () => {
  it.each(["active", "trialing", "past_due"])(
    "refuses a new checkout while the org has a %s subscription",
    async (status) => {
      mocks.stripeSubscriptions = [{ id: "sub_a", status }];

      await expect(checkout()).rejects.toMatchObject({ status: 400 });
      expect(mocks.checkoutCreate).not.toHaveBeenCalled();
    }
  );

  it.each(["canceled", "incomplete_expired", "unpaid"])(
    "allows a new checkout when the org's previous subscription is %s",
    async (status) => {
      mocks.stripeSubscriptions = [{ id: "sub_a", status }];

      await expect(checkout()).resolves.toBe("https://checkout.stripe.com/c/1");
    }
  );

  it("allows the first checkout", async () => {
    await expect(checkout()).resolves.toBe("https://checkout.stripe.com/c/1");
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        subscription_data: expect.objectContaining({ metadata: expect.objectContaining({ keyway_org_id: "org-1" }) }),
      })
    );
  });
});
