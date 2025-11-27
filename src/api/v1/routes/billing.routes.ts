import { FastifyInstance } from 'fastify';
import { authenticateGitHub } from '../../../middleware/auth';
import { sendData } from '../../../lib';

/**
 * Billing routes (placeholder endpoints for future Stripe/Paddle integration)
 * POST /api/v1/billing/create-checkout-session - Create checkout session for upgrade
 * POST /api/v1/billing/manage - Get billing portal link
 */
export async function billingRoutes(fastify: FastifyInstance) {
  /**
   * POST /create-checkout-session
   * Placeholder for creating a Stripe/Paddle checkout session
   * Returns upgrade URL for now
   */
  fastify.post('/create-checkout-session', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    // TODO: Implement Stripe checkout session creation
    // const body = CreateCheckoutSchema.parse(request.body);
    // const session = await stripe.checkout.sessions.create({...});

    return sendData(reply, {
      upgrade_url: 'https://keyway.sh/upgrade',
      message: 'Billing integration coming soon',
    }, { requestId: request.id });
  });

  /**
   * POST /manage
   * Placeholder for Stripe/Paddle billing portal
   * Returns portal URL for now
   */
  fastify.post('/manage', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    // TODO: Implement Stripe billing portal
    // const session = await stripe.billingPortal.sessions.create({...});

    return sendData(reply, {
      portal_url: 'https://keyway.sh/upgrade',
      message: 'Billing portal coming soon',
    }, { requestId: request.id });
  });
}
