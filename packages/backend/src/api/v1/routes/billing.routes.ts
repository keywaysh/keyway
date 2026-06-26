import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { authenticateGitHub } from "../../../middleware/auth";
import { db, users } from "../../../db";
import {
  isStripeEnabled,
  createCheckoutSession,
  createPortalSession,
  getUserSubscription,
  constructWebhookEvent,
  handleWebhookEvent,
  getAvailablePrices,
  type ResolvedPrice,
} from "../../../services";
import { config } from "../../../config";
import { sendData } from "../../../lib/response";
import {
  ServiceUnavailableError,
  BadRequestError,
  ValidationError,
  InternalError,
} from "../../../lib/errors";
import { logger } from "../../../utils/sharedLogger";

// Extend FastifyContextConfig for rawBody support
declare module "fastify" {
  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}

// Request schemas
const createCheckoutSessionSchema = z.object({
  priceId: z.string().min(1, "Price ID is required"),
  successUrl: z.string().url("Valid success URL required"),
  cancelUrl: z.string().url("Valid cancel URL required"),
});

const manageSchema = z.object({
  returnUrl: z.string().url("Valid return URL required"),
});

/**
 * Shape a resolved Stripe price for the API response.
 * Keeps the historical `price` field (amount in cents) and adds `currency`.
 */
function toApiPrice(price: ResolvedPrice | null | undefined) {
  if (!price) {
    return null;
  }
  return {
    id: price.id,
    price: price.amount,
    currency: price.currency,
    interval: price.interval,
  };
}

/**
 * Billing routes for Stripe subscription management
 */
export async function billingRoutes(fastify: FastifyInstance) {
  /**
   * GET /prices
   * Get available subscription prices
   */
  fastify.get("/prices", async (request, reply) => {
    if (!isStripeEnabled()) {
      throw new ServiceUnavailableError("Billing is not currently available");
    }

    // Amounts and currency are resolved directly from Stripe (single source of
    // truth) via lookup_keys — no hardcoded prices here.
    const prices = await getAvailablePrices();

    return sendData(
      reply,
      {
        prices: {
          pro: {
            monthly: toApiPrice(prices?.pro.monthly),
            yearly: toApiPrice(prices?.pro.yearly),
          },
          team: {
            monthly: toApiPrice(prices?.team.monthly),
            yearly: toApiPrice(prices?.team.yearly),
          },
          business: {
            monthly: toApiPrice(prices?.business.monthly),
            yearly: toApiPrice(prices?.business.yearly),
          },
        },
      },
      { requestId: request.id }
    );
  });

  /**
   * GET /subscription
   * Get the authenticated user's current subscription
   */
  fastify.get(
    "/subscription",
    {
      preHandler: [authenticateGitHub],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        return sendData(
          reply,
          {
            subscription: null,
            plan: "free",
            billingStatus: "active",
          },
          { requestId: request.id }
        );
      }

      if (!isStripeEnabled()) {
        return sendData(
          reply,
          {
            subscription: null,
            plan: user.plan,
            billingStatus: user.billingStatus,
          },
          { requestId: request.id }
        );
      }

      const subscription = await getUserSubscription(user.id);

      return sendData(
        reply,
        {
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              }
            : null,
          plan: user.plan,
          billingStatus: user.billingStatus,
          stripeCustomerId: user.stripeCustomerId,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /create-checkout-session
   * Create a Stripe Checkout session for subscription
   */
  fastify.post(
    "/create-checkout-session",
    {
      preHandler: [authenticateGitHub],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!isStripeEnabled()) {
        throw new ServiceUnavailableError("Billing is not currently available");
      }

      // Validate request body
      const parseResult = createCheckoutSessionSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw ValidationError.fromZodError(parseResult.error);
      }

      const { priceId, successUrl, cancelUrl } = parseResult.data;

      // Check if user already has an active subscription (active or trialing)
      if (
        user &&
        user.plan !== "free" &&
        (user.billingStatus === "active" || user.billingStatus === "trialing")
      ) {
        throw new BadRequestError(
          "You already have an active subscription. Use the billing portal to manage it."
        );
      }

      // Validate price ID is one we recognize (all individual plans)
      const prices = await getAvailablePrices();
      const validPriceIds = [
        prices?.pro.monthly?.id,
        prices?.pro.yearly?.id,
        prices?.team.monthly?.id,
        prices?.team.yearly?.id,
        prices?.business.monthly?.id,
        prices?.business.yearly?.id,
      ].filter(Boolean);

      if (!validPriceIds.includes(priceId)) {
        throw new BadRequestError("Invalid price ID");
      }

      // Validate URLs are from allowed origins
      const allowedOrigins = config.cors.allowedOrigins;
      if (allowedOrigins.length > 0) {
        const successOrigin = new URL(successUrl).origin;
        const cancelOrigin = new URL(cancelUrl).origin;
        if (!allowedOrigins.includes(successOrigin) || !allowedOrigins.includes(cancelOrigin)) {
          throw new BadRequestError("Redirect URLs must be from allowed origins");
        }
      }

      // Use existing user ID or we'll need to create user first via the service
      const userId = user?.id;
      if (!userId) {
        throw new BadRequestError("Please log in to Keyway first to create your account");
      }

      try {
        const checkoutUrl = await createCheckoutSession(
          userId,
          user.email || `${user.username}@users.noreply.github.com`,
          user.username,
          priceId,
          successUrl,
          cancelUrl
        );

        return sendData(reply, { url: checkoutUrl }, { requestId: request.id });
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : "Unknown error" },
          "Failed to create checkout session"
        );
        throw new InternalError("Failed to create checkout session");
      }
    }
  );

  /**
   * POST /manage
   * Create a Stripe Customer Portal session
   */
  fastify.post(
    "/manage",
    {
      preHandler: [authenticateGitHub],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!isStripeEnabled()) {
        throw new ServiceUnavailableError("Billing is not currently available");
      }

      // Validate request body
      const parseResult = manageSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw ValidationError.fromZodError(parseResult.error);
      }

      const { returnUrl } = parseResult.data;

      // Check if user has a Stripe customer ID
      if (!user?.stripeCustomerId) {
        throw new BadRequestError("No billing account found. Subscribe to a plan first.");
      }

      // Validate return URL is from allowed origins
      const allowedOrigins = config.cors.allowedOrigins;
      if (allowedOrigins.length > 0) {
        const returnOrigin = new URL(returnUrl).origin;
        if (!allowedOrigins.includes(returnOrigin)) {
          throw new BadRequestError("Return URL must be from an allowed origin");
        }
      }

      try {
        const portalUrl = await createPortalSession(user.id, returnUrl);
        return sendData(reply, { url: portalUrl }, { requestId: request.id });
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : "Unknown error" },
          "Failed to create portal session"
        );
        throw new InternalError("Failed to create billing portal session");
      }
    }
  );

  /**
   * POST /webhook
   * Handle Stripe webhook events
   * Note: This endpoint uses raw body for signature verification
   * Note: Webhook format is intentionally different (Stripe-specific)
   */
  fastify.post(
    "/webhook",
    {
      config: {
        rawBody: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isStripeEnabled()) {
        throw new ServiceUnavailableError("Billing is not configured");
      }

      const signature = request.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        throw new BadRequestError("Missing Stripe signature header");
      }

      // Get raw body for signature verification
      const rawBody = (request as any).rawBody as Buffer;
      if (!rawBody) {
        throw new BadRequestError("Missing raw request body");
      }

      try {
        const event = constructWebhookEvent(rawBody, signature);
        await handleWebhookEvent(event);

        // Webhook response format (Stripe-specific)
        return reply.send({ received: true });
      } catch (error: any) {
        logger.error({ error: error.message }, "Webhook error");

        // Return 400 for signature verification errors
        if (error.message.includes("signature")) {
          throw new BadRequestError("Invalid webhook signature");
        }

        // For other errors, still return 200 to prevent Stripe retries
        // The event was already recorded for idempotency
        // Return generic message — internal details already logged above
        return reply.send({ received: true, error: "Processing failed" });
      }
    }
  );
}
