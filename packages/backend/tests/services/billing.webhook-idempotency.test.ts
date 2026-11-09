import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A Stripe event counts as processed only once its side effects succeeded:
 *
 *  - an error while processing leaves it unprocessed, so Stripe's retry
 *    applies it (instead of being a no-op);
 *  - a delivery that dies mid-way does not block the event forever: its claim
 *    expires and a later retry takes over;
 *  - a duplicate delivered while the first is still being processed is turned
 *    away (409, Stripe retries later) instead of applying the event twice.
 */

const mocks = vi.hoisted(() => ({
  subscriptionsList: vi.fn(),
  updateOrganizationPlan: vi.fn(),
  getOrganizationById: vi.fn(),
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
  convertTrial: vi.fn().mockResolvedValue({ success: true }),
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

const USER = { keyway_user_id: "u-1" };
const ORG = { keyway_org_id: "org-1" };

const userPlan = () => billingDb.users.find((u) => u.id === "u-1")?.plan;
const isRecorded = (eventId: string) => billingDb.webhookEvents.some((e) => e.stripeEventId === eventId);

function userActivates() {
  const sub = stripeSubscription("sub_a", "active", "team", USER);
  mocks.subscriptionsList.mockResolvedValue({ data: [sub], has_more: false });
  return stripeEvent("customer.subscription.updated", sub, "evt_1");
}

beforeEach(() => {
  vi.clearAllMocks();
  billingDb.reset();
  billingDb.users.push({ id: "u-1", plan: "free", billingStatus: "active" });
  mocks.getOrganizationById.mockResolvedValue({
    id: "org-1",
    login: "acme",
    plan: "team",
    trialStartedAt: null,
    trialConvertedAt: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleWebhookEvent marks an event processed only after its side effects", () => {
  it("records the event after the plan was written", async () => {
    await handleWebhookEvent(userActivates());

    expect(userPlan()).toBe("team");
    const recordedAt = billingDb.writes.indexOf("insert stripe_webhook_events evt_1");
    const planWrittenAt = billingDb.writes.indexOf("update users");
    expect(recordedAt).toBeGreaterThan(-1);
    expect(planWrittenAt).toBeGreaterThan(-1);
    expect(recordedAt).toBeGreaterThan(planWrittenAt);
  });

  it("leaves the event unprocessed when processing fails, so Stripe's retry applies it", async () => {
    const event = userActivates();
    billingDb.failingTables.add("users");

    await expect(handleWebhookEvent(event)).rejects.toThrow();
    expect(isRecorded("evt_1")).toBe(false);

    // Stripe retries the same event once the failure is gone
    billingDb.failingTables.clear();
    await handleWebhookEvent(event);

    expect(userPlan()).toBe("team");
    expect(isRecorded("evt_1")).toBe(true);
  });

  it("skips an event that was already processed", async () => {
    const event = userActivates();
    billingDb.webhookEvents.push({ stripeEventId: "evt_1", eventType: event.type, processedAt: new Date() });

    await handleWebhookEvent(event);

    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(userPlan()).toBe("free");
  });

  it("records an event it has nothing to do for", async () => {
    await handleWebhookEvent({ id: "evt_other", type: "invoice.paid", data: { object: {} } } as any);

    expect(isRecorded("evt_other")).toBe(true);
  });
});

describe("handleWebhookEvent with concurrent or interrupted deliveries", () => {
  const orgEvent = () =>
    stripeEvent("customer.subscription.updated", stripeSubscription("sub_a", "unpaid", "team", ORG), "evt_org");

  it("turns away a duplicate delivered while the first is being processed, and applies the event once", async () => {
    let releaseStripe!: () => void;
    mocks.subscriptionsList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStripe = () => resolve({ data: [], has_more: false });
        })
    );

    const first = handleWebhookEvent(orgEvent());
    await vi.waitFor(() => expect(mocks.subscriptionsList).toHaveBeenCalledTimes(1));

    await expect(handleWebhookEvent(orgEvent())).rejects.toMatchObject({ status: 409 });

    releaseStripe();
    await first;
    expect(mocks.updateOrganizationPlan).toHaveBeenCalledTimes(1);
    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
    expect(isRecorded("evt_org")).toBe(true);

    // ...and the duplicate's retry, once the first is done, is a no-op
    await handleWebhookEvent(orgEvent());
    expect(mocks.updateOrganizationPlan).toHaveBeenCalledTimes(1);
  });

  it("lets a retry take over an event whose delivery died mid-way, once its claim is stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T10:00:00Z"));
    // The first delivery never gets past the Stripe call (process killed).
    mocks.subscriptionsList.mockImplementationOnce(() => new Promise(() => {}));
    void handleWebhookEvent(orgEvent());
    await vi.waitFor(() => expect(mocks.subscriptionsList).toHaveBeenCalledTimes(1));

    // A retry shortly after still finds the claim fresh
    vi.setSystemTime(new Date("2026-11-08T10:01:00Z"));
    await expect(handleWebhookEvent(orgEvent())).rejects.toMatchObject({ status: 409 });

    // A retry long after takes the event over and applies it
    vi.setSystemTime(new Date("2026-11-08T11:00:00Z"));
    mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: false });
    await handleWebhookEvent(orgEvent());

    expect(mocks.updateOrganizationPlan).toHaveBeenCalledWith("org-1", "free");
    expect(isRecorded("evt_org")).toBe(true);
  });
});
