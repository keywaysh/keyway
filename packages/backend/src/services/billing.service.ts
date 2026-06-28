import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, users, subscriptions, stripeWebhookEvents, organizations, type UserPlan } from "../db";
import { config } from "../config";
import { trackEvent, identifyUser, AnalyticsEvents } from "../utils/analytics";
import { logActivity } from "./activity.service";
import { logger } from "../utils/sharedLogger";
import { BadRequestError } from "../lib";
import {
  updateOrganizationPlan,
  setOrganizationStripeCustomerId,
  getOrganizationById,
} from "./organization.service";
import { convertTrial, hasHadTrial } from "./trial.service";

// Initialize Stripe client (only if configured)
const stripe = config.stripe ? new Stripe(config.stripe.secretKey) : null;

const LOOKUP_KEYS = {
  pro: { monthly: "pro_month_eur", yearly: "pro_year_eur" },
  team: { monthly: "team_month_eur", yearly: "team_year_eur" },
  business: { monthly: "business_month_eur", yearly: "business_year_eur" },
} as const;

const LOOKUP_KEY_TO_PLAN: Record<string, UserPlan> = {
  pro_month_eur: "pro",
  pro_year_eur: "pro",
  team_month_eur: "team",
  team_year_eur: "team",
  business_month_eur: "business",
  business_year_eur: "business",
};

export interface ResolvedPrice {
  id: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
}

let priceCache: Map<string, Stripe.Price> | null = null;

async function resolvePrices(): Promise<Map<string, Stripe.Price>> {
  if (priceCache) {
    return priceCache;
  }
  const s = getStripe();
  const lookupKeys = Object.values(LOOKUP_KEYS).flatMap((p) => [p.monthly, p.yearly]);
  const res = await s.prices.list({ lookup_keys: lookupKeys, active: true, limit: 100 });

  const map = new Map<string, Stripe.Price>();
  for (const price of res.data) {
    if (price.lookup_key) {
      map.set(price.lookup_key, price);
    }
  }
  priceCache = map;
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
 * Record a processed webhook event
 */
async function recordWebhookEvent(eventId: string, eventType: string): Promise<void> {
  await db.insert(stripeWebhookEvents).values({
    stripeEventId: eventId,
    eventType,
  });
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
  const priceId = price.id;

  const plan = await getPlanFromPrice(price);
  if (!plan) {
    logger.warn({ priceId }, "Unknown price ID");
    return;
  }

  // Map Stripe status to our billing status
  const billingStatus = mapStripeToBillingStatus(subscription.status);

  // Get current period end from subscription items (Stripe v20 structure)
  const subscriptionItem = subscription.items.data[0];
  const currentPeriodEnd = subscriptionItem?.current_period_end
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

  // Update user plan and billing status
  await db
    .update(users)
    .set({
      plan,
      billingStatus,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  logger.info({ userId, plan, billingStatus }, "Updated user plan");

  // Track billing upgrade/downgrade events
  if (previousPlan !== plan) {
    const isUpgrade = getPlanRank(plan) > getPlanRank(previousPlan);

    // Log activity
    await logActivity({
      userId,
      action: isUpgrade ? "plan_upgraded" : "plan_downgraded",
      platform: "api",
      metadata: {
        previousPlan,
        newPlan: plan,
        billingInterval: subscription.items.data[0]?.price.recurring?.interval || "unknown",
        source: "stripe_webhook",
      },
    });

    // Track analytics
    if (previousPlan === "free" && plan !== "free") {
      trackEvent(userId, AnalyticsEvents.BILLING_UPGRADE, {
        previousPlan,
        newPlan: plan,
        billingInterval: subscription.items.data[0]?.price.recurring?.interval || "unknown",
      });
      // Update user identity with new plan
      identifyUser(userId, { plan });
    }
  }
}

/**
 * Get numeric rank for plan comparison (free=0, pro=1, team=2, business=3)
 */
function getPlanRank(plan: UserPlan): number {
  switch (plan) {
    case "free":
      return 0;
    case "pro":
      return 1;
    case "team":
      return 2;
    case "business":
      return 3;
    default:
      return 0;
  }
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

  // Get current user plan before downgrade
  const [currentUser] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const previousPlan = currentUser?.plan || "pro";

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
 * Handle a Stripe webhook event
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  if (!config.billing.enabled) {
    logger.debug("Billing is disabled, skipping webhook event");
    return;
  }

  // Check idempotency
  if (await isEventProcessed(event.id)) {
    logger.debug({ eventId: event.id }, "Event already processed");
    return;
  }

  // Record event first (for idempotency)
  await recordWebhookEvent(event.id, event.type);

  // Handle event by type
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
    pro: {
      monthly: toResolvedPrice(prices.get(LOOKUP_KEYS.pro.monthly), "month"),
      yearly: toResolvedPrice(prices.get(LOOKUP_KEYS.pro.yearly), "year"),
    },
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

  const activeSubs = await s.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
  if (activeSubs.data.length > 0) {
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
  const priceId = price.id;

  const plan = await getPlanFromPrice(price);
  if (!plan) {
    logger.warn({ priceId }, "Unknown price ID for org");
    return;
  }

  // Check if org was on trial and convert it
  const org = await getOrganizationById(orgId);
  if (org && hasHadTrial(org) && !org.trialConvertedAt && subscription.status === "active") {
    await convertTrial({
      orgId,
      userId: orgId, // System action - use org ID as actor
      platform: "api",
      stripeCustomerId: subscription.customer as string,
    });
    logger.info({ orgId }, "Converted trial to paid subscription");
  }

  // Update organization plan
  await updateOrganizationPlan(orgId, plan);
  logger.info({ orgId, plan }, "Updated organization plan");
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

  // Downgrade org to free plan
  await updateOrganizationPlan(orgId, "free");
  logger.info({ orgId }, "Downgraded organization to free plan (subscription deleted)");
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
