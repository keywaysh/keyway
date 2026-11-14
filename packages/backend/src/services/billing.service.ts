import Stripe from "stripe";
import { and, eq, lt } from "drizzle-orm";
import { db, users, subscriptions, stripeWebhookEvents, organizations, type UserPlan } from "../db";
import { config } from "../config";
import { trackEvent, identifyUser, AnalyticsEvents } from "../utils/analytics";
import { logActivity } from "./activity.service";
import { logger } from "../utils/sharedLogger";
import { BadRequestError, ConflictError } from "../lib";
import {
  updateOrganizationPlan,
  setOrganizationStripeCustomerId,
  getOrganizationById,
} from "./organization.service";
import { convertTrial, hasHadTrial } from "./trial.service";
import { planRank } from "../config/plans";

// Initialize Stripe client (only if configured)
const stripe = config.stripe ? new Stripe(config.stripe.secretKey) : null;

const LOOKUP_KEYS = {
  team: { monthly: "team_month_eur", yearly: "team_year_eur" },
  business: { monthly: "business_month_eur", yearly: "business_year_eur" },
} as const;

// Derived inverse of LOOKUP_KEYS so adding/removing a tier is a single edit
const LOOKUP_KEY_TO_PLAN: Record<string, UserPlan> = Object.fromEntries(
  (Object.entries(LOOKUP_KEYS) as [UserPlan, { monthly: string; yearly: string }][]).flatMap(
    ([plan, keys]) => [
      [keys.monthly, plan],
      [keys.yearly, plan],
    ]
  )
);

/**
 * Stripe statuses under which a subscription grants its plan. past_due is the
 * dunning grace period: Stripe moves it on to canceled/unpaid if retries fail.
 */
const ENTITLED_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/**
 * Statuses a subscription never leaves: a payload carrying one is the
 * subscription's current state, whatever order its events arrive in.
 */
const ENDED_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "canceled",
  "incomplete_expired",
]);

function isEntitled(status: Stripe.Subscription.Status): boolean {
  return ENTITLED_SUBSCRIPTION_STATUSES.has(status);
}

function customerIdOf(subscription: Stripe.Subscription): string | null {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : (subscription.customer?.id ?? null);
}

interface CurrentSubscriptions {
  /** The event's subscription in its current state. */
  eventSubscription: Stripe.Subscription;
  /** The highest-tier subscription of the owner that is entitled right now. */
  entitlement: { subscription: Stripe.Subscription; plan: UserPlan } | null;
}

/**
 * Where the owner of `subscription` (a user or an org) stands with Stripe
 * right now.
 *
 * The plan is never taken from an event payload: payloads are snapshots that
 * Stripe does not deliver in order (an `active` snapshot can arrive after the
 * cancellation or downgrade that followed it), and an owner can hold several
 * subscriptions at once (parallel checkouts: Team and Business). So Stripe is
 * asked for the customer's subscriptions (one subscriptions.list call: the
 * non-canceled ones, 100 at most) and the entitlement is the highest tier
 * among those that are entitled and carry the owner's metadata. Ties go to
 * `preferredId` (the stored current subscription) so it doesn't flap.
 *
 * Throws if Stripe can't be asked: the event is then left unprocessed and
 * Stripe retries it.
 */
async function currentSubscriptions(
  subscription: Stripe.Subscription,
  owner: { key: "keyway_org_id" | "keyway_user_id"; id: string },
  customerId: string,
  preferredId?: string
): Promise<CurrentSubscriptions> {
  const { data, has_more } = await getStripe().subscriptions.list({
    customer: customerId,
    limit: 100,
  });
  if (has_more) {
    logger.warn({ customerId }, "Customer has over 100 Stripe subscriptions; using the latest 100");
  }

  const eventEnded = ENDED_SUBSCRIPTION_STATUSES.has(subscription.status);
  // The list leaves canceled subscriptions out: one missing from it was canceled.
  const eventSubscription: Stripe.Subscription = eventEnded
    ? subscription
    : (data.find((s) => s.id === subscription.id) ?? { ...subscription, status: "canceled" });

  let entitlement: CurrentSubscriptions["entitlement"] = null;
  for (const candidate of data) {
    if (
      candidate.metadata?.[owner.key] !== owner.id ||
      !isEntitled(candidate.status) ||
      (eventEnded && candidate.id === subscription.id)
    ) {
      continue;
    }
    const price = candidate.items.data[0]?.price;
    const plan = price ? await getPlanFromPrice(price) : null;
    if (!plan) {
      continue;
    }
    const rank = planRank(plan);
    const bestRank = entitlement ? planRank(entitlement.plan) : -1;
    if (rank > bestRank || (rank === bestRank && candidate.id === preferredId)) {
      entitlement = { subscription: candidate, plan };
    }
  }
  return { eventSubscription, entitlement };
}

export interface ResolvedPrice {
  id: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
}

// Without a TTL, a price rotation in Stripe (archive + replace) would leave
// stale price IDs cached until the next deploy — and checkout fails on
// archived prices.
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;
// Short expiry for incomplete results (e.g. mid-rotation): retry soon instead
// of pinning a broken price list for the full TTL.
const PRICE_CACHE_RETRY_MS = 60 * 1000;

let priceCache: Map<string, Stripe.Price> | null = null;
let priceCacheExpiresAt = 0;

async function resolvePrices(): Promise<Map<string, Stripe.Price>> {
  if (priceCache && Date.now() < priceCacheExpiresAt) {
    return priceCache;
  }
  const s = getStripe();
  const lookupKeys = Object.values(LOOKUP_KEYS).flatMap((p) => [p.monthly, p.yearly]);

  let res: Stripe.ApiList<Stripe.Price>;
  try {
    res = await s.prices.list({ lookup_keys: lookupKeys, active: true, limit: 100 });
  } catch (error) {
    // Serve the expired cache rather than failing checkout, /prices and
    // webhook plan resolution during a transient Stripe outage. Re-arm the
    // expiry so concurrent/subsequent requests don't each re-hit Stripe
    // (and eat its timeout) for the whole outage.
    if (priceCache) {
      priceCacheExpiresAt = Date.now() + PRICE_CACHE_RETRY_MS;
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Stripe price refresh failed; serving stale price cache"
      );
      return priceCache;
    }
    throw error;
  }

  const map = new Map<string, Stripe.Price>();
  for (const price of res.data) {
    if (price.lookup_key) {
      map.set(price.lookup_key, price);
    }
  }
  if (map.size !== lookupKeys.length) {
    logger.warn(
      { missing: lookupKeys.filter((k) => !map.has(k)) },
      "Some Stripe lookup keys are unresolved; caching prices briefly"
    );
  }
  priceCache = map;
  priceCacheExpiresAt =
    Date.now() + (map.size === lookupKeys.length ? PRICE_CACHE_TTL_MS : PRICE_CACHE_RETRY_MS);
  return map;
}

function toResolvedPrice(
  price: Stripe.Price | undefined,
  interval: "month" | "year"
): ResolvedPrice | null {
  if (!price || price.unit_amount === null || price.recurring?.interval !== interval) {
    return null;
  }
  return {
    id: price.id,
    amount: price.unit_amount,
    currency: price.currency,
    interval,
  };
}

/**
 * Check if Stripe billing is enabled
 */
export function isStripeEnabled(): boolean {
  return config.billing.enabled && stripe !== null && config.stripe !== undefined;
}

/**
 * Get the Stripe client (throws if not configured)
 */
function getStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  return stripe;
}

async function getPlanFromPrice(price: Stripe.Price): Promise<UserPlan | null> {
  if (price.lookup_key && LOOKUP_KEY_TO_PLAN[price.lookup_key]) {
    return LOOKUP_KEY_TO_PLAN[price.lookup_key];
  }
  return getPlanFromPriceId(price.id);
}

/**
 * Map Stripe price ID to plan by resolving our lookup_keys.
 */
async function getPlanFromPriceId(priceId: string): Promise<UserPlan | null> {
  if (!config.stripe) {
    return null;
  }
  const prices = await resolvePrices();
  for (const [lookupKey, price] of prices) {
    if (price.id === priceId) {
      return LOOKUP_KEY_TO_PLAN[lookupKey] ?? null;
    }
  }
  return null;
}

/**
 * Get or create a Stripe customer for a user
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  username: string
): Promise<string> {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  // Check if user already has a Stripe customer ID
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await s.customers.create({
    email,
    name: username,
    metadata: {
      keyway_user_id: userId,
    },
  });

  // Store customer ID in database
  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return customer.id;
}

/**
 * Create a Stripe Checkout session for subscription
 */
export async function createCheckoutSession(
  userId: string,
  email: string,
  username: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  // Get or create customer
  const customerId = await getOrCreateStripeCustomer(userId, email, username);

  // Create checkout session
  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      keyway_user_id: userId,
    },
    subscription_data: {
      metadata: {
        keyway_user_id: userId,
      },
    },
  });

  if (!session.url) {
    throw new Error("Failed to create checkout session");
  }

  return session.url;
}

/**
 * Create a Stripe Customer Portal session
 */
export async function createPortalSession(userId: string, returnUrl: string): Promise<string> {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  // Get user's Stripe customer ID
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.stripeCustomerId) {
    throw new Error("No billing account found");
  }

  const session = await s.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Get user's current subscription
 */
export async function getUserSubscription(userId: string) {
  if (!config.billing.enabled) {
    return null;
  }

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return subscription || null;
}

/**
 * Check if a webhook event has already been processed (idempotency)
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: stripeWebhookEvents.id })
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, eventId))
    .limit(1);

  return !!existing;
}

/**
 * How long a delivery may hold an event before a retry of the same event may
 * take it over: processing takes seconds, so an older claim's holder died.
 */
const WEBHOOK_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * The row that marks an event as being processed, kept in stripe_webhook_events
 * next to the processed markers: `stripe_event_id` is unique, so inserting it
 * is an atomic claim, and its `processed_at` holds the claim time. Stripe
 * event ids start with "evt_", so a claim never collides with one.
 */
function webhookClaimKey(eventId: string): string {
  return `claim:${eventId}`;
}

/**
 * Claim `event` for this delivery. Returns false when it was already
 * processed. Throws ConflictError (409: Stripe retries later) while another
 * delivery is processing it, so concurrent duplicates don't apply it twice.
 */
async function claimWebhookEvent(event: Stripe.Event): Promise<boolean> {
  if (await isEventProcessed(event.id)) {
    return false;
  }
  const key = webhookClaimKey(event.id);
  const [claimed] = await db
    .insert(stripeWebhookEvents)
    .values({ stripeEventId: key, eventType: event.type, processedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });
  if (!claimed) {
    // Another delivery holds the event: take it over only if its claim is stale.
    const [takenOver] = await db
      .update(stripeWebhookEvents)
      .set({ processedAt: new Date() })
      .where(
        and(
          eq(stripeWebhookEvents.stripeEventId, key),
          lt(stripeWebhookEvents.processedAt, new Date(Date.now() - WEBHOOK_CLAIM_TTL_MS))
        )
      )
      .returning({ id: stripeWebhookEvents.id });
    if (!takenOver) {
      throw new ConflictError("This Stripe event is already being processed");
    }
    logger.warn({ eventId: event.id }, "Taking over a stale claim on a Stripe event");
  }
  // The delivery we raced with may have finished between the first check and the claim.
  if (await isEventProcessed(event.id)) {
    await releaseWebhookEvent(event.id);
    return false;
  }
  return true;
}

async function releaseWebhookEvent(eventId: string): Promise<void> {
  await db
    .delete(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, webhookClaimKey(eventId)));
}

/** Mark a claimed event processed, once its side effects succeeded. */
async function completeWebhookEvent(event: Stripe.Event): Promise<void> {
  await db
    .insert(stripeWebhookEvents)
    .values({ stripeEventId: event.id, eventType: event.type })
    .onConflictDoNothing();
  await releaseWebhookEvent(event.id).catch((err) =>
    // Harmless leftover: the processed marker is what later deliveries check.
    logger.warn({ err, eventId: event.id }, "Could not delete the claim of a processed Stripe event")
  );
}

/**
 * Handle subscription created/updated event
 */
async function handleSubscriptionChange(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata.keyway_user_id;
  if (!userId) {
    logger.warn(
      { subscriptionId: subscription.id },
      "Subscription missing keyway_user_id metadata"
    );
    return;
  }

  const price = subscription.items.data[0]?.price;
  if (!price) {
    logger.warn({ subscriptionId: subscription.id }, "Subscription missing price");
    return;
  }
  if (!(await getPlanFromPrice(price))) {
    logger.warn({ priceId: price.id }, "Unknown price ID");
    return;
  }

  await syncUserSubscription(subscription, userId);
}

/**
 * Handle subscription deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata.keyway_user_id;
  if (!userId) {
    logger.warn({ subscriptionId: subscription.id }, "Deleted subscription missing keyway_user_id");
    return;
  }

  await syncUserSubscription(subscription, userId);
}

/**
 * Bring the user's stored subscription and plan in line with what Stripe holds
 * for them now (see currentSubscriptions), after an event about `subscription`:
 *
 *  - an entitled subscription (the highest tier) becomes the stored, current
 *    one and sets the plan;
 *  - otherwise only the stored current subscription may take the plan down: a
 *    late event about a subscription the user has since replaced changes
 *    nothing (that one's own events maintain the plan);
 *  - a canceled current subscription is removed and the user drops to free;
 *  - any other one is stored with its status: still `incomplete` (first
 *    payment pending, nothing paid, nothing ended) the plan is kept, anything
 *    else (unpaid, paused, incomplete_expired) drops to free.
 */
async function syncUserSubscription(subscription: Stripe.Subscription, userId: string) {
  const customerId = customerIdOf(subscription);
  if (!customerId) {
    logger.warn({ subscriptionId: subscription.id }, "Subscription missing customer");
    return;
  }

  const current = await getUserSubscription(userId);
  const { eventSubscription, entitlement } = await currentSubscriptions(
    subscription,
    { key: "keyway_user_id", id: userId },
    customerId,
    current?.stripeSubscriptionId
  );

  if (entitlement) {
    await storeUserSubscription(userId, entitlement.subscription, entitlement.plan);
    return;
  }

  if (current && current.stripeSubscriptionId !== eventSubscription.id) {
    logger.info(
      {
        userId,
        subscriptionId: eventSubscription.id,
        currentSubscriptionId: current.stripeSubscriptionId,
        status: eventSubscription.status,
      },
      "Ignoring status change of a subscription that is not the user's current one"
    );
    return;
  }

  if (eventSubscription.status === "canceled") {
    await removeUserSubscription(userId);
    return;
  }

  if (isEntitled(eventSubscription.status)) {
    // Entitled, yet not counted above: its price is not one of our plans.
    logger.warn(
      { userId, subscriptionId: eventSubscription.id },
      "Entitled subscription with an unknown price; plan left unchanged"
    );
    return;
  }

  await storeUserSubscription(
    userId,
    eventSubscription,
    eventSubscription.status === "incomplete" ? null : "free"
  );
}

/**
 * Store `subscription` as the user's current one and set the user's plan to
 * `plan` (null keeps the current plan).
 */
async function storeUserSubscription(
  userId: string,
  subscription: Stripe.Subscription,
  plan: UserPlan | null
): Promise<void> {
  const subscriptionItem = subscription.items.data[0];
  if (!subscriptionItem) {
    logger.warn({ subscriptionId: subscription.id }, "Subscription missing price");
    return;
  }
  const priceId = subscriptionItem.price.id;

  // Map Stripe status to our billing status
  const billingStatus = mapStripeToBillingStatus(subscription.status);

  // Get current period end from subscription items (Stripe v20 structure)
  const currentPeriodEnd = subscriptionItem.current_period_end
    ? new Date(subscriptionItem.current_period_end * 1000)
    : new Date(); // Fallback to now if not available

  // Upsert subscription record
  await db
    .insert(subscriptions)
    .values({
      userId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      status: subscription.status,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: subscription.status,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });

  // Get current user plan before update
  const [currentUser] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const previousPlan = currentUser?.plan || "free";
  const newPlan = plan ?? previousPlan;

  // Update user plan and billing status
  await db
    .update(users)
    .set({
      plan: newPlan,
      billingStatus,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  logger.info({ userId, plan: newPlan, billingStatus }, "Updated user plan");

  // Track billing upgrade/downgrade events
  if (previousPlan !== newPlan) {
    const isUpgrade = planRank(newPlan) > planRank(previousPlan);
    const billingInterval = subscriptionItem.price.recurring?.interval || "unknown";

    // Log activity
    await logActivity({
      userId,
      action: isUpgrade ? "plan_upgraded" : "plan_downgraded",
      platform: "api",
      metadata: {
        previousPlan,
        newPlan,
        billingInterval,
        source: "stripe_webhook",
      },
    });

    // Track analytics
    if (previousPlan === "free" && newPlan !== "free") {
      trackEvent(userId, AnalyticsEvents.BILLING_UPGRADE, {
        previousPlan,
        newPlan,
        billingInterval,
      });
      // Update user identity with new plan
      identifyUser(userId, { plan: newPlan });
    }
  }
}

/**
 * The user's current subscription is gone: delete its row and drop to free.
 */
async function removeUserSubscription(userId: string): Promise<void> {
  // Get current user plan before downgrade
  const [currentUser] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const previousPlan = currentUser?.plan || "free";

  // Delete subscription record
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));

  // Downgrade user to free plan
  await db
    .update(users)
    .set({
      plan: "free",
      billingStatus: "canceled",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  logger.info({ userId }, "Downgraded user to free plan (subscription deleted)");

  // Already free (e.g. an `unpaid` event dropped the plan first): nothing to report.
  if (previousPlan === "free") {
    return;
  }

  // Log activity
  await logActivity({
    userId,
    action: "plan_downgraded",
    platform: "api",
    metadata: {
      previousPlan,
      newPlan: "free",
      reason: "subscription_deleted",
      source: "stripe_webhook",
    },
  });

  // Track billing downgrade event
  trackEvent(userId, AnalyticsEvents.BILLING_DOWNGRADE, {
    previousPlan,
    newPlan: "free",
    reason: "subscription_deleted",
  });
  // Update user identity with new plan
  identifyUser(userId, { plan: "free" });
}

/**
 * Handle invoice payment failed event
 */
async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;

  // Find user by Stripe customer ID
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (!user) {
    logger.warn({ customerId }, "Payment failed for unknown customer");
    return;
  }

  // Update billing status to past_due
  await db
    .update(users)
    .set({
      billingStatus: "past_due",
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  logger.info({ userId: user.id }, "Marked user as past_due (payment failed)");

  // Track payment failed event
  trackEvent(user.id, AnalyticsEvents.BILLING_PAYMENT_FAILED, {
    invoiceId: invoice.id,
  });
}

/**
 * Map Stripe subscription status to our billing status
 */
function mapStripeToBillingStatus(
  stripeStatus: Stripe.Subscription.Status
): "active" | "past_due" | "canceled" | "trialing" {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    case "trialing":
      return "trialing";
    case "incomplete":
    case "paused":
    default:
      return "active";
  }
}

/**
 * Construct and verify a Stripe webhook event
 */
export function constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  if (!config.stripe?.webhookSecret) {
    throw new Error("Webhook secret not configured");
  }

  return s.webhooks.constructEvent(payload, signature, config.stripe.webhookSecret);
}

/**
 * Handle a Stripe webhook event, at most once.
 *
 * The event is recorded as processed only after its side effects succeeded.
 * If they fail, the claim is released and the error propagates, so the route
 * answers 5xx and Stripe retries the event; if the process dies mid-way, the
 * claim goes stale and a later retry takes over. A duplicate delivered while
 * the event is being processed gets a ConflictError (409) and is retried later.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  if (!config.billing.enabled) {
    logger.debug("Billing is disabled, skipping webhook event");
    return;
  }

  if (!(await claimWebhookEvent(event))) {
    logger.debug({ eventId: event.id }, "Event already processed");
    return;
  }

  try {
    await applyWebhookEvent(event);
  } catch (err) {
    await releaseWebhookEvent(event.id).catch((releaseErr) =>
      logger.error(
        { err: releaseErr, eventId: event.id },
        "Could not release a failed Stripe event; a retry takes it over once its claim is stale"
      )
    );
    throw err;
  }

  await completeWebhookEvent(event);
}

async function applyWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      // Check if this is an org subscription
      if (subscription.metadata.keyway_org_id) {
        await handleOrgSubscriptionChange(subscription);
      } else {
        await handleSubscriptionChange(subscription);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      // Check if this is an org subscription
      if (subscription.metadata.keyway_org_id) {
        await handleOrgSubscriptionDeleted(subscription);
      } else {
        await handleSubscriptionDeleted(subscription);
      }
      break;
    }

    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    default:
      logger.debug({ eventType: event.type }, "Unhandled event type");
  }
}

/**
 * Get available prices for checkout, resolved from Stripe via lookup_keys.
 */
export async function getAvailablePrices() {
  if (!config.billing.enabled || !config.stripe) {
    return null;
  }

  const prices = await resolvePrices();

  return {
    team: {
      monthly: toResolvedPrice(prices.get(LOOKUP_KEYS.team.monthly), "month"),
      yearly: toResolvedPrice(prices.get(LOOKUP_KEYS.team.yearly), "year"),
    },
    business: {
      monthly: toResolvedPrice(prices.get(LOOKUP_KEYS.business.monthly), "month"),
      yearly: toResolvedPrice(prices.get(LOOKUP_KEYS.business.yearly), "year"),
    },
  };
}

// ============================================================================
// Organization Billing Functions
// ============================================================================

/**
 * Get or create a Stripe customer for an organization
 */
export async function getOrCreateOrgStripeCustomer(
  orgId: string,
  orgLogin: string,
  ownerEmail: string
): Promise<string> {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  // Check if org already has a Stripe customer ID
  const [org] = await db
    .select({ stripeCustomerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (org?.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  // Create new Stripe customer for the org
  const customer = await s.customers.create({
    email: ownerEmail,
    name: `${orgLogin} (Organization)`,
    metadata: {
      keyway_org_id: orgId,
      keyway_org_login: orgLogin,
    },
  });

  // Store customer ID in database
  await setOrganizationStripeCustomerId(orgId, customer.id);

  return customer.id;
}

/**
 * Create a Stripe Checkout session for organization subscription
 */
export async function createOrgCheckoutSession(
  orgId: string,
  orgLogin: string,
  ownerEmail: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  if (!config.stripe) {
    throw new Error("Stripe is not configured");
  }
  const prices = await getAvailablePrices();
  const orgPriceIds = [
    prices?.team.monthly?.id,
    prices?.team.yearly?.id,
    prices?.business.monthly?.id,
    prices?.business.yearly?.id,
  ].filter(Boolean);
  if (!orgPriceIds.includes(priceId)) {
    throw new BadRequestError("Organizations can subscribe to the Team or Business plan");
  }

  // Get or create customer
  const customerId = await getOrCreateOrgStripeCustomer(orgId, orgLogin, ownerEmail);

  // Any subscription that already grants a plan (trialing and past_due as well
  // as active) means the org pays: another checkout would run two in parallel.
  // Without a status filter, Stripe lists every subscription that is not canceled.
  const existingSubs = await s.subscriptions.list({ customer: customerId, limit: 100 });
  if (existingSubs.data.some((sub) => isEntitled(sub.status))) {
    throw new BadRequestError(
      "Organization already has an active subscription. Use the billing portal to change plans."
    );
  }

  // Create checkout session
  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      keyway_org_id: orgId,
      keyway_org_login: orgLogin,
    },
    subscription_data: {
      metadata: {
        keyway_org_id: orgId,
        keyway_org_login: orgLogin,
      },
    },
  });

  if (!session.url) {
    throw new Error("Failed to create checkout session");
  }

  return session.url;
}

/**
 * Create a Stripe Customer Portal session for organization
 */
export async function createOrgPortalSession(orgId: string, returnUrl: string): Promise<string> {
  if (!config.billing.enabled) {
    throw new Error("Billing is not enabled");
  }
  const s = getStripe();

  // Get org's Stripe customer ID
  const [org] = await db
    .select({ stripeCustomerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org?.stripeCustomerId) {
    throw new Error("No billing account found for organization");
  }

  const session = await s.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Handle organization subscription change from webhook
 */
export async function handleOrgSubscriptionChange(
  subscription: Stripe.Subscription
): Promise<void> {
  const orgId = subscription.metadata.keyway_org_id;
  if (!orgId) {
    // Not an org subscription
    return;
  }

  const price = subscription.items.data[0]?.price;
  if (!price) {
    logger.warn({ subscriptionId: subscription.id }, "Org subscription missing price");
    return;
  }
  if (!(await getPlanFromPrice(price))) {
    logger.warn({ priceId: price.id }, "Unknown price ID for org");
    return;
  }

  await syncOrgPlan(subscription, orgId);
}

/**
 * Handle organization subscription deleted from webhook
 */
export async function handleOrgSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const orgId = subscription.metadata.keyway_org_id;
  if (!orgId) {
    // Not an org subscription
    return;
  }

  await syncOrgPlan(subscription, orgId);
}

/**
 * Set the org's plan from the subscriptions Stripe holds for it now (see
 * currentSubscriptions), after an event about `subscription`: the highest
 * tier among its entitled subscriptions, else free. Organizations store no
 * subscription row, so this is recomputed on every event, which also covers
 * ending one of two parallel subscriptions (cancelling Business while Team
 * still runs leaves Team, not Business).
 *
 * While the event's subscription is still `incomplete` and nothing else is
 * entitled, nothing has been paid and nothing has ended: the plan is left
 * alone. During a Keyway trial the effective plan comes from the trial dates,
 * whatever is written here (see getEffectivePlanWithTrial).
 */
async function syncOrgPlan(subscription: Stripe.Subscription, orgId: string): Promise<void> {
  const customerId = customerIdOf(subscription);
  if (!customerId) {
    logger.warn({ orgId, subscriptionId: subscription.id }, "Org subscription missing customer");
    return;
  }

  const { eventSubscription, entitlement } = await currentSubscriptions(
    subscription,
    { key: "keyway_org_id", id: orgId },
    customerId
  );

  // A subscription that is actually live converts the trial: from then on the
  // org's plan is the one this webhook maintains.
  const org = await getOrganizationById(orgId);
  if (entitlement && org && hasHadTrial(org) && !org.trialConvertedAt) {
    await convertTrial({
      orgId,
      userId: null, // System action (Stripe webhook): no user started it
      platform: "api",
      stripeCustomerId: customerId,
    });
    logger.info({ orgId }, "Converted trial to paid subscription");
  }

  let plan: UserPlan;
  if (entitlement) {
    plan = entitlement.plan;
  } else if (eventSubscription.status === "incomplete") {
    logger.info(
      { orgId, subscriptionId: eventSubscription.id },
      "Organization plan unchanged: first payment of the subscription is still incomplete"
    );
    return;
  } else if (isEntitled(eventSubscription.status)) {
    // Entitled, yet not counted: its price is not one of our plans.
    logger.warn(
      { orgId, subscriptionId: eventSubscription.id },
      "Entitled org subscription with an unknown price; plan left unchanged"
    );
    return;
  } else {
    plan = "free";
  }

  await updateOrganizationPlan(orgId, plan);
  logger.info(
    {
      orgId,
      plan,
      subscriptionId: entitlement?.subscription.id ?? eventSubscription.id,
      status: entitlement?.subscription.status ?? eventSubscription.status,
    },
    "Updated organization plan"
  );
}

/**
 * Get organization billing status
 */
export async function getOrgBillingStatus(orgId: string) {
  if (!config.billing.enabled) {
    return {
      plan: "business" as const,
      hasStripeCustomer: false,
    };
  }

  const [org] = await db
    .select({
      plan: organizations.plan,
      stripeCustomerId: organizations.stripeCustomerId,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) {
    return null;
  }

  return {
    plan: org.plan,
    hasStripeCustomer: !!org.stripeCustomerId,
  };
}
