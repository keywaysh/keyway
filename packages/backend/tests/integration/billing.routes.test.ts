import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/testApp';

// Use vi.hoisted for mocks that need to be available in vi.mock
const mockStripeEnabled = vi.hoisted(() => vi.fn());
const mockGetAvailablePrices = vi.hoisted(() => vi.fn());
const mockGetUserSubscription = vi.hoisted(() => vi.fn());
const mockCreateCheckoutSession = vi.hoisted(() => vi.fn());
const mockCreatePortalSession = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());

// Mock config
vi.mock('../../src/config', () => ({
  config: {
    cors: {
      allowedOrigins: ['https://app.keyway.sh'],
    },
  },
}));

// Mock services
vi.mock('../../src/services', () => ({
  isStripeEnabled: mockStripeEnabled,
  getAvailablePrices: mockGetAvailablePrices,
  getUserSubscription: mockGetUserSubscription,
  createCheckoutSession: mockCreateCheckoutSession,
  createPortalSession: mockCreatePortalSession,
  constructWebhookEvent: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

// Mock database
vi.mock('../../src/db', () => ({
  db: {
    query: {
      users: {
        findFirst: mockFindFirst,
      },
    },
  },
  users: {},
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth', () => ({
  authenticateGitHub: vi.fn().mockImplementation(async (request) => {
    request.githubUser = {
      githubId: 12345,
      username: 'testuser',
    };
  }),
  requireApiKeyScope: vi.fn(() => async () => {
    // Allow access by default in tests
  }),
}));

describe('Billing Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock implementations
    mockStripeEnabled.mockReturnValue(true);
    mockGetAvailablePrices.mockReturnValue({
      pro: {
        monthly: 'price_pro_monthly',
        yearly: 'price_pro_yearly',
      },
      team: {
        monthly: 'price_team_monthly',
        yearly: 'price_team_yearly',
      },
      startup: {
        monthly: 'price_startup_monthly',
        yearly: 'price_startup_yearly',
      },
    });
    mockGetUserSubscription.mockResolvedValue(null);
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/session/123');
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/portal/123');
    mockFindFirst.mockResolvedValue({
      id: 'user-123',
      githubId: 12345,
      username: 'testuser',
      email: 'test@example.com',
      plan: 'free',
      billingStatus: 'active',
      stripeCustomerId: null,
    });

    app = await createTestApp();

    const { billingRoutes } = await import('../../src/api/v1/routes/billing.routes');
    await app.register(billingRoutes, { prefix: '/v1/billing' });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/billing/prices', () => {
    it('should return prices with data wrapper', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/billing/prices',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify response wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('requestId');

      // Verify data contents
      expect(body.data).toHaveProperty('prices');
      expect(body.data.prices).toHaveProperty('pro');
      expect(body.data.prices.pro).toHaveProperty('monthly');
      expect(body.data.prices.pro).toHaveProperty('yearly');
    });

    it('should return 503 when Stripe is disabled', async () => {
      mockStripeEnabled.mockReturnValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/billing/prices',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);

      // Verify RFC 7807 error format
      expect(body).toHaveProperty('type');
      expect(body).toHaveProperty('title');
      expect(body).toHaveProperty('status');
      expect(body.status).toBe(503);
      expect(body.title).toBe('Service Unavailable');
    });

    it('should return Team prices when configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/billing/prices',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.prices).toHaveProperty('team');
      expect(body.data.prices.team).toHaveProperty('monthly');
      expect(body.data.prices.team).toHaveProperty('yearly');
      expect(body.data.prices.team.monthly.id).toBe('price_team_monthly');
      expect(body.data.prices.team.yearly.id).toBe('price_team_yearly');
    });
  });

  describe('GET /v1/billing/subscription', () => {
    it('should return subscription with data wrapper', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/billing/subscription',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify response wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('requestId');

      // Verify data contents
      expect(body.data).toHaveProperty('subscription');
      expect(body.data).toHaveProperty('plan');
      expect(body.data).toHaveProperty('billingStatus');
    });

    it('should return subscription details when user has one', async () => {
      mockGetUserSubscription.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        currentPeriodEnd: new Date('2025-01-01'),
        cancelAtPeriodEnd: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/billing/subscription',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.subscription).not.toBeNull();
      expect(body.data.subscription).toHaveProperty('id');
      expect(body.data.subscription).toHaveProperty('status');
    });
  });

  describe('POST /v1/billing/create-checkout-session', () => {
    it('should return checkout URL with data wrapper', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_pro_monthly',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify response wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('requestId');

      // Verify data contents
      expect(body.data).toHaveProperty('url');
      expect(body.data.url).toBe('https://checkout.stripe.com/session/123');
    });

    it('should return 400 for invalid price ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'invalid_price',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      // Verify RFC 7807 error format
      expect(body).toHaveProperty('type');
      expect(body).toHaveProperty('title');
      expect(body).toHaveProperty('status');
      expect(body.status).toBe(400);
    });

    it('should return 400 for invalid URLs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_pro_monthly',
          successUrl: 'not-a-url',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.status).toBe(400);
    });

    it('should return 503 when Stripe is disabled', async () => {
      mockStripeEnabled.mockReturnValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_pro_monthly',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(503);
    });

    it('should return 400 when user has active subscription', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'user-123',
        githubId: 12345,
        username: 'testuser',
        email: 'test@example.com',
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_team_monthly',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.detail).toContain('already have an active subscription');
    });

    it('should return 400 when user has trialing subscription', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'user-123',
        githubId: 12345,
        username: 'testuser',
        email: 'test@example.com',
        plan: 'pro',
        billingStatus: 'trialing',
        stripeCustomerId: 'cus_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_team_monthly',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.detail).toContain('already have an active subscription');
    });

    it('should accept Team price IDs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_team_monthly',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.url).toBe('https://checkout.stripe.com/session/123');
    });

    it('should allow checkout for users with past_due status', async () => {
      // past_due users might be allowed to create new subscriptions
      // (Stripe will handle the old one)
      mockFindFirst.mockResolvedValue({
        id: 'user-123',
        githubId: 12345,
        username: 'testuser',
        email: 'test@example.com',
        plan: 'pro',
        billingStatus: 'past_due',
        stripeCustomerId: 'cus_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/create-checkout-session',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_pro_monthly',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      // This should succeed - past_due is not blocked
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /v1/billing/manage', () => {
    it('should return portal URL with data wrapper when user has customer ID', async () => {
      // Mock user with stripeCustomerId
      mockFindFirst.mockResolvedValue({
        id: 'user-123',
        githubId: 12345,
        username: 'testuser',
        email: 'test@example.com',
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/manage',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          returnUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify response wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('requestId');

      // Verify data contents
      expect(body.data).toHaveProperty('url');
    });

    it('should return 400 when user has no billing account', async () => {
      // User without stripeCustomerId (default mock already set in beforeEach)
      const response = await app.inject({
        method: 'POST',
        url: '/v1/billing/manage',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          returnUrl: 'https://app.keyway.sh/billing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      // Verify RFC 7807 error format
      expect(body).toHaveProperty('type');
      expect(body).toHaveProperty('title');
      expect(body.detail).toContain('No billing account');
    });
  });

  describe('Response format consistency', () => {
    it('all successful responses should have data and meta properties', async () => {
      // Test /prices
      let response = await app.inject({
        method: 'GET',
        url: '/v1/billing/prices',
      });
      expect(JSON.parse(response.body)).toHaveProperty('data');
      expect(JSON.parse(response.body)).toHaveProperty('meta');

      // Test /subscription
      response = await app.inject({
        method: 'GET',
        url: '/v1/billing/subscription',
      });
      expect(JSON.parse(response.body)).toHaveProperty('data');
      expect(JSON.parse(response.body)).toHaveProperty('meta');
    });

    it('all error responses should follow RFC 7807 format', async () => {
      mockStripeEnabled.mockReturnValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/billing/prices',
      });

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('type');
      expect(body).toHaveProperty('title');
      expect(body).toHaveProperty('status');
      expect(body.type).toContain('service-unavailable');
    });
  });
});
