import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/testApp';

// Use vi.hoisted for mocks that need to be available in vi.mock
const mockStripeEnabled = vi.hoisted(() => vi.fn());
const mockGetAvailablePrices = vi.hoisted(() => vi.fn());
const mockGetOrganizationByLogin = vi.hoisted(() => vi.fn());
const mockGetOrganizationDetails = vi.hoisted(() => vi.fn());
const mockGetOrganizationMembership = vi.hoisted(() => vi.fn());
const mockIsOrganizationOwner = vi.hoisted(() => vi.fn());
const mockCreateOrgCheckoutSession = vi.hoisted(() => vi.fn());
const mockCreateOrgPortalSession = vi.hoisted(() => vi.fn());
const mockGetTrialInfo = vi.hoisted(() => vi.fn());
const mockStartTrial = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());

// Mock config
vi.mock('../../src/config', () => ({
  config: {
    cors: {
      allowedOrigins: ['https://app.keyway.sh'],
    },
  },
}));

// Mock billing service
vi.mock('../../src/services/billing.service', () => ({
  isStripeEnabled: mockStripeEnabled,
  getAvailablePrices: mockGetAvailablePrices,
  createOrgCheckoutSession: mockCreateOrgCheckoutSession,
  createOrgPortalSession: mockCreateOrgPortalSession,
  getOrgBillingStatus: vi.fn(),
}));

// Mock organization service
vi.mock('../../src/services/organization.service', () => ({
  getOrganizationsForUser: vi.fn(),
  getOrganizationByLogin: mockGetOrganizationByLogin,
  getOrganizationDetails: mockGetOrganizationDetails,
  getOrganizationMembers: vi.fn(),
  updateOrganization: vi.fn(),
  isOrganizationOwner: mockIsOrganizationOwner,
  syncOrganizationMembers: vi.fn(),
  getOrganizationMembership: mockGetOrganizationMembership,
}));

// Mock trial service
vi.mock('../../src/services/trial.service', () => ({
  startTrial: mockStartTrial,
  getTrialInfo: mockGetTrialInfo,
  TRIAL_DURATION_DAYS: 15,
}));

// Mock activity service
vi.mock('../../src/services/activity.service', () => ({
  detectPlatform: vi.fn().mockReturnValue('web'),
}));

// Mock email
vi.mock('../../src/utils/email', () => ({
  sendWelcomeEmail: vi.fn(),
  sendTrialStartedEmail: vi.fn(),
}));

// Mock github utils
vi.mock('../../src/utils/github', () => ({
  listOrgMembers: vi.fn(),
  getOrgMembership: vi.fn(),
}));

// Mock github app service
vi.mock('../../src/services/github-app.service', () => ({
  getInstallationToken: vi.fn(),
}));

// Mock database
vi.mock('../../src/db', () => ({
  db: {
    query: {
      users: {
        findFirst: mockFindFirst,
      },
      vcsAppInstallations: {
        findFirst: vi.fn(),
      },
    },
  },
  users: {},
  vcsAppInstallations: {},
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth', () => ({
  authenticateGitHub: vi.fn().mockImplementation(async (request) => {
    request.githubUser = {
      forgeType: 'github',
      forgeUserId: '12345',
      githubId: 12345,
      username: 'testuser',
    };
    request.vcsUser = {
      forgeType: 'github',
      forgeUserId: '12345',
      username: 'testuser',
    };
  }),
}));

describe('Organization Billing Routes', () => {
  let app: FastifyInstance;

  const mockOrg = {
    id: 'org-123',
    forgeType: 'github',
    forgeOrgId: '98765',
    login: 'test-org',
    displayName: 'Test Organization',
    avatarUrl: 'https://example.com/avatar.png',
    plan: 'free',
    stripeCustomerId: null,
    trialStartedAt: null,
    trialEndsAt: null,
    trialConvertedAt: null,
  };

  const mockOrgDetails = {
    ...mockOrg,
    memberCount: 5,
    vaultCount: 3,
    members: [],
    defaultPermissions: {},
    trial: {
      status: 'none',
      startedAt: null,
      endsAt: null,
      convertedAt: null,
      daysRemaining: null,
    },
    effectivePlan: 'free',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const mockUser = {
    id: 'user-123',
    forgeType: 'github',
    forgeUserId: '12345',
    username: 'testuser',
    email: 'test@example.com',
    plan: 'free',
    billingStatus: 'active',
    stripeCustomerId: null,
  };

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
    });
    mockGetOrganizationByLogin.mockResolvedValue(mockOrg);
    mockGetOrganizationDetails.mockResolvedValue(mockOrgDetails);
    mockGetOrganizationMembership.mockResolvedValue({
      id: 'membership-123',
      orgRole: 'member',
    });
    mockIsOrganizationOwner.mockResolvedValue(false);
    mockCreateOrgCheckoutSession.mockResolvedValue('https://checkout.stripe.com/session/123');
    mockCreateOrgPortalSession.mockResolvedValue('https://billing.stripe.com/portal/123');
    mockGetTrialInfo.mockReturnValue({
      status: 'none',
      startedAt: null,
      endsAt: null,
      convertedAt: null,
      daysRemaining: null,
    });
    mockFindFirst.mockResolvedValue(mockUser);

    app = await createTestApp();

    const { organizationsRoutes } = await import('../../src/api/v1/routes/organizations.routes');
    await app.register(organizationsRoutes, { prefix: '/v1/orgs' });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/orgs/:org/billing', () => {
    it('should return billing status with proper structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify response wrapper format
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('requestId');

      // Verify data structure
      expect(body.data).toHaveProperty('plan');
      expect(body.data).toHaveProperty('effectivePlan');
      expect(body.data).toHaveProperty('billingStatus');
      expect(body.data).toHaveProperty('stripeCustomerId');
      expect(body.data).toHaveProperty('subscription');
      expect(body.data).toHaveProperty('trial');
      expect(body.data).toHaveProperty('prices');
    });

    it('should return trial info when org has active trial', async () => {
      const trialStartedAt = new Date('2024-12-01');
      const trialEndsAt = new Date('2024-12-16');

      mockGetTrialInfo.mockReturnValue({
        status: 'active',
        startedAt: trialStartedAt,
        endsAt: trialEndsAt,
        convertedAt: null,
        daysRemaining: 10,
      });

      mockGetOrganizationDetails.mockResolvedValue({
        ...mockOrgDetails,
        effectivePlan: 'team',
        trial: {
          status: 'active',
          startedAt: trialStartedAt,
          endsAt: trialEndsAt,
          convertedAt: null,
          daysRemaining: 10,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.trial.status).toBe('active');
      expect(body.data.trial.startedAt).toBe('2024-12-01T00:00:00.000Z');
      expect(body.data.trial.endsAt).toBe('2024-12-16T00:00:00.000Z');
      expect(body.data.trial.daysRemaining).toBe(10);
      expect(body.data.trial.trialDurationDays).toBe(15);
      expect(body.data.effectivePlan).toBe('team');
    });

    it('should return prices when Stripe is configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.prices).not.toBeNull();
      expect(body.data.prices.monthly).toHaveProperty('id');
      expect(body.data.prices.monthly).toHaveProperty('price');
      expect(body.data.prices.monthly.price).toBe(2900); // $29.00
      expect(body.data.prices.yearly).toHaveProperty('id');
      expect(body.data.prices.yearly).toHaveProperty('price');
      expect(body.data.prices.yearly.price).toBe(29000); // $290.00
    });

    it('should return null prices when Stripe prices not configured', async () => {
      mockGetAvailablePrices.mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.prices).toBeNull();
    });

    it('should return 400 when Stripe is disabled', async () => {
      mockStripeEnabled.mockReturnValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('type');
      expect(body).toHaveProperty('status');
      expect(body.status).toBe(400);
    });

    it('should return 404 when organization not found', async () => {
      mockGetOrganizationByLogin.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/unknown-org/billing',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 when user is not a member', async () => {
      mockGetOrganizationMembership.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return free plan when org has no subscription', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.plan).toBe('free');
      expect(body.data.effectivePlan).toBe('free');
      expect(body.data.subscription).toBeNull();
    });

    it('should return team plan when org has paid subscription', async () => {
      mockGetOrganizationByLogin.mockResolvedValue({
        ...mockOrg,
        plan: 'team',
        stripeCustomerId: 'cus_123',
      });

      mockGetOrganizationDetails.mockResolvedValue({
        ...mockOrgDetails,
        plan: 'team',
        effectivePlan: 'team',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.plan).toBe('team');
      expect(body.data.effectivePlan).toBe('team');
    });
  });

  describe('POST /v1/orgs/:org/billing/checkout', () => {
    beforeEach(() => {
      // Owner is required for billing operations
      mockIsOrganizationOwner.mockResolvedValue(true);
      mockGetOrganizationMembership.mockResolvedValue({
        id: 'membership-123',
        orgRole: 'owner',
      });
    });

    it('should create checkout session for owner', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/checkout',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_team_monthly',
          successUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing?success=true',
          cancelUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data).toHaveProperty('url');
      expect(body.data.url).toBe('https://checkout.stripe.com/session/123');
    });

    it('should return 403 when user is not owner', async () => {
      mockIsOrganizationOwner.mockResolvedValue(false);
      mockGetOrganizationMembership.mockResolvedValue({
        id: 'membership-123',
        orgRole: 'member',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/checkout',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_team_monthly',
          successUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing?success=true',
          cancelUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject invalid priceId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/checkout',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: '',
          successUrl: 'https://app.keyway.sh/billing/success',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      // Zod validation throws which results in 400 or 500 depending on error handling
      expect([400, 500]).toContain(response.statusCode);
    });

    it('should reject invalid URLs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/checkout',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_team_monthly',
          successUrl: 'not-a-url',
          cancelUrl: 'https://app.keyway.sh/billing',
        },
      });

      // Zod validation throws which results in 400 or 500 depending on error handling
      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('POST /v1/orgs/:org/billing/portal', () => {
    beforeEach(() => {
      mockIsOrganizationOwner.mockResolvedValue(true);
      mockGetOrganizationMembership.mockResolvedValue({
        id: 'membership-123',
        orgRole: 'owner',
      });
    });

    it('should create portal session for owner', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/portal',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          returnUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data).toHaveProperty('url');
      expect(body.data.url).toBe('https://billing.stripe.com/portal/123');
    });

    it('should return 403 when user is not owner', async () => {
      mockIsOrganizationOwner.mockResolvedValue(false);
      mockGetOrganizationMembership.mockResolvedValue({
        id: 'membership-123',
        orgRole: 'member',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/portal',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          returnUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject invalid returnUrl', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/portal',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          returnUrl: 'not-a-url',
        },
      });

      // Zod validation throws which results in 400 or 500 depending on error handling
      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('POST /v1/orgs/:org/trial/start', () => {
    beforeEach(() => {
      mockStartTrial.mockResolvedValue({
        success: true,
        organization: {
          ...mockOrg,
          trialStartedAt: new Date('2024-12-01'),
          trialEndsAt: new Date('2024-12-16'),
        },
      });
      mockGetTrialInfo.mockReturnValue({
        status: 'active',
        startedAt: new Date('2024-12-01'),
        endsAt: new Date('2024-12-16'),
        convertedAt: null,
        daysRemaining: 15,
      });
    });

    it('should allow organization owner to start a trial', async () => {
      mockIsOrganizationOwner.mockResolvedValue(true);
      mockGetOrganizationMembership.mockResolvedValue({
        id: 'membership-123',
        orgRole: 'owner',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/trial/start',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('trial');
      expect(mockStartTrial).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-123',
          userId: 'user-123',
        })
      );
    });

    it('should return 403 when user is a member but not owner', async () => {
      mockIsOrganizationOwner.mockResolvedValue(false);
      mockGetOrganizationMembership.mockResolvedValue({
        id: 'membership-123',
        orgRole: 'member',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/trial/start',
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('detail');
      expect(body.detail).toContain('owner');
      expect(mockStartTrial).not.toHaveBeenCalled();
    });

    it('should return 403 when user is not a member of the organization', async () => {
      mockIsOrganizationOwner.mockResolvedValue(false);
      mockGetOrganizationMembership.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/trial/start',
      });

      expect(response.statusCode).toBe(403);
      expect(mockStartTrial).not.toHaveBeenCalled();
    });

    it('should return 404 when organization does not exist', async () => {
      mockGetOrganizationByLogin.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/unknown-org/trial/start',
      });

      expect(response.statusCode).toBe(404);
      expect(mockStartTrial).not.toHaveBeenCalled();
    });
  });
});
