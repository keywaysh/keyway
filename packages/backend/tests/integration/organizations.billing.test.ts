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
const mockGetOrgMembershipForCurrentUser = vi.hoisted(() => vi.fn());
const mockGetOrgMembership = vi.hoisted(() => vi.fn());
const mockUpsertOrganizationMember = vi.hoisted(() => vi.fn());
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
  upsertOrganizationMember: mockUpsertOrganizationMember,
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
  getOrgMembership: mockGetOrgMembership,
  getOrgMembershipForCurrentUser: mockGetOrgMembershipForCurrentUser,
}));

// Mock github app service
vi.mock('../../src/services/github-app.service', () => ({
  getInstallationToken: vi.fn().mockResolvedValue('install-token'),
  findOrgInstallationViaGitHubAPI: vi.fn().mockResolvedValue(null),
  syncInstallationFromAPI: vi.fn(),
}));

// Mock database
vi.mock('../../src/db', () => ({
  db: {
    query: {
      users: {
        findFirst: mockFindFirst,
      },
      vcsAppInstallations: {
        findFirst: vi.fn().mockResolvedValue({
          installationId: 123,
          accountLogin: 'test-org',
          accountType: 'organization',
          status: 'active',
        }),
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
    request.accessToken = 'test-access-token';
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
    // getAvailablePrices is async; orgs subscribe to the Business tier
    mockGetAvailablePrices.mockResolvedValue({
      pro: {
        monthly: { id: 'price_pro_monthly', amount: 900, currency: 'eur', interval: 'month' },
        yearly: { id: 'price_pro_yearly', amount: 9000, currency: 'eur', interval: 'year' },
      },
      team: {
        monthly: { id: 'price_team_monthly', amount: 1900, currency: 'eur', interval: 'month' },
        yearly: { id: 'price_team_yearly', amount: 19000, currency: 'eur', interval: 'year' },
      },
      business: {
        monthly: { id: 'price_business_monthly', amount: 3900, currency: 'eur', interval: 'month' },
        yearly: { id: 'price_business_yearly', amount: 39000, currency: 'eur', interval: 'year' },
      },
    });
    mockGetOrganizationByLogin.mockResolvedValue(mockOrg);
    mockGetOrganizationDetails.mockResolvedValue(mockOrgDetails);
    mockGetOrganizationMembership.mockResolvedValue({
      id: 'membership-123',
      orgRole: 'member',
    });
    mockGetOrgMembership.mockResolvedValue({ role: 'member', state: 'active' });
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
    mockUpsertOrganizationMember.mockResolvedValue({});

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
        effectivePlan: 'business',
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
      expect(body.data.effectivePlan).toBe('business');
    });

    it('should return prices when Stripe is configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Orgs can subscribe to Team or Business; both tiers are returned
      expect(body.data.prices.team.monthly.price).toBe(1900); // €19.00 (Team)
      expect(body.data.prices.team.yearly.price).toBe(19000); // €190.00 (Team)
      expect(body.data.prices.business.monthly.price).toBe(3900); // €39.00 (Business)
      expect(body.data.prices.business.yearly.price).toBe(39000); // €390.00 (Business)
    });

    it('should return null tier prices when Stripe prices not configured', async () => {
      mockGetAvailablePrices.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.prices.team).toBeNull();
      expect(body.data.prices.business).toBeNull();
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

    it('should return business plan when org has paid subscription', async () => {
      mockGetOrganizationByLogin.mockResolvedValue({
        ...mockOrg,
        plan: 'business',
        stripeCustomerId: 'cus_123',
      });

      mockGetOrganizationDetails.mockResolvedValue({
        ...mockOrgDetails,
        plan: 'business',
        effectivePlan: 'business',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/orgs/test-org/billing',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.plan).toBe('business');
      expect(body.data.effectivePlan).toBe('business');
    });
  });

  describe('POST /v1/orgs/:org/billing/checkout', () => {
    beforeEach(() => {
      // Owner is required for billing operations
      mockGetOrgMembership.mockResolvedValue({ role: 'admin', state: 'active' });
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
          priceId: 'price_business_monthly',
          successUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing?success=true',
          cancelUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data).toHaveProperty('url');
      expect(body.data.url).toBe('https://checkout.stripe.com/session/123');
    });

    it('should reject checkout when org already has a paid subscription', async () => {
      // Paid org: has a Stripe customer + a paid plan, and is not on an active trial
      mockGetOrganizationByLogin.mockResolvedValue({
        ...mockOrg,
        plan: 'business',
        stripeCustomerId: 'cus_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/checkout',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_business_monthly',
          successUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing?success=true',
          cancelUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mockCreateOrgCheckoutSession).not.toHaveBeenCalled();
    });

    it('should allow checkout for an org on an active trial (conversion)', async () => {
      // Active trial: plan is 'business' and a Stripe customer may exist from an
      // abandoned checkout, but the org must still be able to convert to paid.
      mockGetOrganizationByLogin.mockResolvedValue({
        ...mockOrg,
        plan: 'business',
        stripeCustomerId: 'cus_123',
      });
      mockGetTrialInfo.mockReturnValue({
        status: 'active',
        startedAt: new Date(),
        endsAt: new Date(),
        convertedAt: null,
        daysRemaining: 10,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/orgs/test-org/billing/checkout',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          priceId: 'price_business_monthly',
          successUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing?success=true',
          cancelUrl: 'https://app.keyway.sh/dashboard/orgs/test-org/billing',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockCreateOrgCheckoutSession).toHaveBeenCalled();
    });

    it('should return 403 when user is not owner', async () => {
      mockGetOrgMembership.mockResolvedValue({ role: 'member', state: 'active' });
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
          priceId: 'price_business_monthly',
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
          priceId: 'price_business_monthly',
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
      mockGetOrgMembership.mockResolvedValue({ role: 'admin', state: 'active' });
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
      mockGetOrgMembership.mockResolvedValue({ role: 'member', state: 'active' });
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
      mockGetOrgMembership.mockResolvedValue({ role: 'admin', state: 'active' });
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
      mockGetOrgMembership.mockResolvedValue({ role: 'member', state: 'active' });
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
      expect(body.detail).toContain('admin');
      expect(mockStartTrial).not.toHaveBeenCalled();
    });

    it('should return 403 when user is not a member of the organization', async () => {
      // GitHub reports no membership for the caller → live admin check denies.
      mockGetOrgMembership.mockResolvedValue(null);
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
