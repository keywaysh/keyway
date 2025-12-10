import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users, subscriptions, stripeWebhookEvents, type UserPlan } from '../db';
import { config } from '../config';
import { trackEvent, identifyUser, AnalyticsEvents } from '../utils/analytics';
import { logActivity } from './activity.service';

// Initialize Stripe client (only if configured)
const stripe = config.stripe
  ? new Stripe(config.stripe.secretKey)
  : null;

/**
 * Check if Stripe billing is enabled
 */
export function isStripeEnabled(): boolean {
  return stripe !== null && config.stripe !== undefined;
}

/**
 * Get the Stripe client (throws if not configured)
 */
function getStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  return stripe;
}

/**
 * Map Stripe price ID to plan
 */
function getPlanFromPriceId(priceId: string): UserPlan | null {
  if (!config.stripe) return null;

  const { prices } = config.stripe;
  if (priceId === prices.proMonthly || priceId === prices.proYearly) {
    return 'pro';
  }
  if (priceId === prices.teamMonthly || priceId === prices.teamYearly) {
    return 'team';
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
  const s = getStripe();

  // Get or create customer
  const customerId = await getOrCreateStripeCustomer(userId, email, username);

  // Create checkout session
  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
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
    throw new Error('Failed to create checkout session');
  }

  return session.url;
}

/**
 * Create a Stripe Customer Portal session
 */
export async function createPortalSession(
  userId: string,
  returnUrl: string
): Promise<string> {
  const s = getStripe();

  // Get user's Stripe customer ID
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.stripeCustomerId) {
    throw new Error('No billing account found');
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
async function handleSubscriptionChange(
  subscription: Stripe.Subscription
): Promise<void> {
  const userId = subscription.metadata.keyway_user_id;
  if (!userId) {
    console.warn('[Billing] Subscription missing keyway_user_id metadata:', subscription.id);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    console.warn('[Billing] Subscription missing price:', subscription.id);
    return;
  }

  const plan = getPlanFromPriceId(priceId);
  if (!plan) {
    console.warn('[Billing] Unknown price ID:', priceId);
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

  const previousPlan = currentUser?.plan || 'free';

  // Update user plan and billing status
  await db
    .update(users)
    .set({
      plan,
      billingStatus,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  console.log(`[Billing] Updated user ${userId} to plan ${plan} (status: ${billingStatus})`);

  // Track billing upgrade/downgrade events
  if (previousPlan !== plan) {
    const isUpgrade = getPlanRank(plan) > getPlanRank(previousPlan);

    // Log activity
    await logActivity({
      userId,
      action: isUpgrade ? 'plan_upgraded' : 'plan_downgraded',
      platform: 'api',
      metadata: {
        previousPlan,
        newPlan: plan,
        billingInterval: subscription.items.data[0]?.price.recurring?.interval || 'unknown',
        source: 'stripe_webhook',
      },
    });

    // Track analytics
    if (previousPlan === 'free' && plan !== 'free') {
      trackEvent(userId, AnalyticsEvents.BILLING_UPGRADE, {
        previousPlan,
        newPlan: plan,
        billingInterval: subscription.items.data[0]?.price.recurring?.interval || 'unknown',
      });
      // Update user identity with new plan
      identifyUser(userId, { plan });
    }
  }
}

/**
 * Get numeric rank for plan comparison (free=0, pro=1, team=2)
 */
function getPlanRank(plan: UserPlan): number {
  switch (plan) {
    case 'free': return 0;
    case 'pro': return 1;
    case 'team': return 2;
    default: return 0;
  }
}

/**
 * Handle subscription deleted event
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const userId = subscription.metadata.keyway_user_id;
  if (!userId) {
    console.warn('[Billing] Deleted subscription missing keyway_user_id:', subscription.id);
    return;
  }

  // Get current user plan before downgrade
  const [currentUser] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const previousPlan = currentUser?.plan || 'pro';

  // Delete subscription record
  await db
    .delete(subscriptions)
    .where(eq(subscriptions.userId, userId));

  // Downgrade user to free plan
  await db
    .update(users)
    .set({
      plan: 'free',
      billingStatus: 'canceled',
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  console.log(`[Billing] Downgraded user ${userId} to free plan (subscription deleted)`);

  // Log activity
  await logActivity({
    userId,
    action: 'plan_downgraded',
    platform: 'api',
    metadata: {
      previousPlan,
      newPlan: 'free',
      reason: 'subscription_deleted',
      source: 'stripe_webhook',
    },
  });

  // Track billing downgrade event
  trackEvent(userId, AnalyticsEvents.BILLING_DOWNGRADE, {
    previousPlan,
    newPlan: 'free',
    reason: 'subscription_deleted',
  });
  // Update user identity with new plan
  identifyUser(userId, { plan: 'free' });
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
    console.warn('[Billing] Payment failed for unknown customer:', customerId);
    return;
  }

  // Update billing status to past_due
  await db
    .update(users)
    .set({
      billingStatus: 'past_due',
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  console.log(`[Billing] Marked user ${user.id} as past_due (payment failed)`);

  // Track payment failed event
  trackEvent(user.id, AnalyticsEvents.BILLING_PAYMENT_FAILED, {
    invoiceId: invoice.id,
  });
}

/**
 * Map Stripe subscription status to our billing status
 */
function mapStripeToBillingStatus(stripeStatus: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' | 'trialing' {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    case 'trialing':
      return 'trialing';
    case 'incomplete':
    case 'paused':
    default:
      return 'active';
  }
}

/**
 * Construct and verify a Stripe webhook event
 */
export function constructWebhookEvent(
  payload: Buffer,
  signature: string
): Stripe.Event {
  const s = getStripe();

  if (!config.stripe?.webhookSecret) {
    throw new Error('Webhook secret not configured');
  }

  return s.webhooks.constructEvent(
    payload,
    signature,
    config.stripe.webhookSecret
  );
}

/**
 * Handle a Stripe webhook event
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Check idempotency
  if (await isEventProcessed(event.id)) {
    console.log(`[Billing] Event already processed: ${event.id}`);
    return;
  }

  // Record event first (for idempotency)
  await recordWebhookEvent(event.id, event.type);

  // Handle event by type
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionChange(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    default:
      console.log(`[Billing] Unhandled event type: ${event.type}`);
  }
}

/**
 * Get available prices for checkout
 */
export function getAvailablePrices() {
  if (!config.stripe) {
    return null;
  }

  return {
    pro: {
      monthly: config.stripe.prices.proMonthly,
      yearly: config.stripe.prices.proYearly,
    },
    team: {
      monthly: config.stripe.prices.teamMonthly,
      yearly: config.stripe.prices.teamYearly,
    },
  };
}
