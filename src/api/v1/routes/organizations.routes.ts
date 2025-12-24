import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateGitHub } from '../../../middleware/auth';
import { db, users, vcsAppInstallations } from '../../../db';
import { sendData, NotFoundError, ForbiddenError, BadRequestError } from '../../../lib';
import {
  getOrganizationsForUser,
  getOrganizationByLogin,
  getOrganizationDetails,
  getOrganizationMembers,
  updateOrganization,
  isOrganizationOwner,
  syncOrganizationMembers,
  getOrganizationMembership,
  ensureOrganizationExists,
  upsertOrganizationMember,
} from '../../../services/organization.service';
import {
  startTrial,
  getTrialInfo,
  TRIAL_DURATION_DAYS,
} from '../../../services/trial.service';
import { detectPlatform } from '../../../services/activity.service';
import { listOrgMembers, getOrgMembership, listUserOrganizations } from '../../../utils/github';
import { getInstallationToken, findOrgInstallationViaGitHubAPI, syncInstallationFromAPI } from '../../../services/github-app.service';
import { eq, and } from 'drizzle-orm';
import {
  isStripeEnabled,
  createOrgCheckoutSession,
  createOrgPortalSession,
  getOrgBillingStatus,
  getAvailablePrices,
} from '../../../services/billing.service';

/**
 * Organization routes
 * GET /api/v1/orgs - List user's organizations
 * GET /api/v1/orgs/:org - Get organization details
 * PUT /api/v1/orgs/:org - Update organization settings
 * GET /api/v1/orgs/:org/members - List organization members
 * POST /api/v1/orgs/:org/members/sync - Force sync members from GitHub
 */
export async function organizationsRoutes(fastify: FastifyInstance) {
  /**
   * GET /
   * List all organizations the user belongs to
   */
  fastify.get('/', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      return sendData(reply, [], { requestId: request.id });
    }

    const orgs = await getOrganizationsForUser(user.id);
    return sendData(reply, orgs, { requestId: request.id });
  });

  /**
   * POST /connect
   * Connect a GitHub organization to Keyway
   * Creates the org in DB and adds user as member
   */
  fastify.post<{
    Body: { orgLogin: string };
  }>('/connect', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { orgLogin } = request.body;
    const vcsUser = request.vcsUser || request.githubUser!;

    // Validate body
    const bodySchema = z.object({
      orgLogin: z.string().min(1).max(100),
    });

    bodySchema.parse({ orgLogin });

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // SECURITY: Verify user has access to this organization via GitHub App installations
    // The /user/installations endpoint only returns orgs where:
    // 1. The GitHub App is installed
    // 2. The user has authorized the app and has access to the org
    const accessToken = request.accessToken;
    if (!accessToken) {
      throw new ForbiddenError('Access token required');
    }

    const userOrgs = await listUserOrganizations(accessToken);
    const targetOrg = userOrgs.find(org => org.login.toLowerCase() === orgLogin.toLowerCase());
    if (!targetOrg) {
      throw new ForbiddenError(
        'You do not have access to this organization or the Keyway app is not installed'
      );
    }

    // Check if org is already connected
    const existingOrg = await getOrganizationByLogin(orgLogin);
    if (existingOrg) {
      // Check if user is already a member
      const membership = await getOrganizationMembership(existingOrg.id, user.id);
      if (membership) {
        // Already connected, just return the org details
        const details = await getOrganizationDetails(existingOrg.id);
        return sendData(reply, {
          organization: details,
          message: 'Organization already connected',
        }, { requestId: request.id });
      }
      // Org exists but user isn't a member - add them
      // Use role from /user/installations (admin or member)
      const keywayRole = targetOrg.role === 'admin' ? 'owner' : 'member';
      await upsertOrganizationMember(existingOrg.id, user.id, keywayRole);
      const details = await getOrganizationDetails(existingOrg.id);
      return sendData(reply, {
        organization: details,
        message: 'Connected to organization',
      }, { requestId: request.id });
    }

    // Check if GitHub App is installed on this org (check DB first, then GitHub API)
    let installation = await db.query.vcsAppInstallations.findFirst({
      where: and(
        eq(vcsAppInstallations.accountLogin, orgLogin),
        eq(vcsAppInstallations.accountType, 'organization'),
        eq(vcsAppInstallations.status, 'active')
      ),
    });

    // If not in DB, try to find via GitHub API (installation webhook may have been missed)
    if (!installation) {
      const apiInstallation = await findOrgInstallationViaGitHubAPI(orgLogin);
      if (apiInstallation) {
        // Sync to DB for future use
        await syncInstallationFromAPI(apiInstallation);
        installation = apiInstallation;
      }
    }

    if (!installation) {
      throw new BadRequestError(
        'GitHub App is not installed on this organization. ' +
        'Please install the Keyway GitHub App first.'
      );
    }

    // Get installation token to fetch org info
    const installToken = await getInstallationToken(installation.installationId);

    // Create the organization using existing service function
    const org = await ensureOrganizationExists(orgLogin, installToken, user.id);

    if (!org) {
      throw new BadRequestError(
        'Could not connect to organization. Please ensure it is a valid GitHub organization.'
      );
    }

    // Get full details
    const details = await getOrganizationDetails(org.id);

    return sendData(reply, {
      organization: details,
      message: 'Organization connected successfully',
    }, { requestId: request.id });
  });

  /**
   * GET /:org
   * Get organization details by login
   */
  fastify.get<{
    Params: { org: string };
  }>('/:org', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is a member
    const membership = await getOrganizationMembership(org.id, user.id);
    if (!membership) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // Get full details
    const details = await getOrganizationDetails(org.id);
    return sendData(reply, {
      ...details,
      role: membership.orgRole,  // Include current user's role
      trialDurationDays: TRIAL_DURATION_DAYS,  // For "Start X-day trial" display
    }, { requestId: request.id });
  });

  /**
   * PUT /:org
   * Update organization settings (org owner only)
   */
  fastify.put<{
    Params: { org: string };
    Body: { displayName?: string; defaultPermissions?: Record<string, unknown> };
  }>('/:org', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const { displayName, defaultPermissions } = request.body;
    const vcsUser = request.vcsUser || request.githubUser!;

    // Validate body
    const bodySchema = z.object({
      displayName: z.string().max(100).optional(),
      defaultPermissions: z.record(z.unknown()).optional(),
    });

    const validatedBody = bodySchema.parse({ displayName, defaultPermissions });

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is org owner
    const isOwner = await isOrganizationOwner(org.id, user.id);
    if (!isOwner) {
      throw new ForbiddenError('Only organization owners can update settings');
    }

    // Update organization
    const updated = await updateOrganization(org.id, validatedBody);
    return sendData(reply, {
      id: updated.id,
      login: updated.login,
      displayName: updated.displayName,
      defaultPermissions: updated.defaultPermissions,
      updatedAt: updated.updatedAt.toISOString(),
    }, { requestId: request.id });
  });

  /**
   * GET /:org/members
   * List organization members
   */
  fastify.get<{
    Params: { org: string };
  }>('/:org/members', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is a member
    const membership = await getOrganizationMembership(org.id, user.id);
    if (!membership) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const members = await getOrganizationMembers(org.id);
    return sendData(reply, members, { requestId: request.id });
  });

  /**
   * POST /:org/members/sync
   * Force sync members from GitHub (org owner only)
   */
  fastify.post<{
    Params: { org: string };
  }>('/:org/members/sync', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const vcsUser = request.vcsUser || request.githubUser!;
    const accessToken = request.accessToken!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is org owner
    const isOwner = await isOrganizationOwner(org.id, user.id);
    if (!isOwner) {
      throw new ForbiddenError('Only organization owners can sync members');
    }

    // Fetch members from GitHub using the user's OAuth token
    // This allows seeing private members (the user is a member of the org)
    // Requires the read:org OAuth scope
    const githubMembers = await listOrgMembers(accessToken, orgLogin);

    // Convert GitHub members to VCS format (id as string)
    const vcsMembers = githubMembers.map(m => ({
      id: String(m.id),
      login: m.login,
      avatar_url: m.avatar_url,
      role: m.role,
    }));

    // Sync with database
    const result = await syncOrganizationMembers(org.id, 'github', vcsMembers);

    return sendData(reply, {
      message: 'Members synced successfully',
      ...result,
    }, { requestId: request.id });
  });

  // =========================================================================
  // Billing Routes
  // =========================================================================

  /**
   * GET /:org/billing
   * Get organization billing status
   */
  fastify.get<{
    Params: { org: string };
  }>('/:org/billing', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const vcsUser = request.vcsUser || request.githubUser!;

    if (!isStripeEnabled()) {
      throw new BadRequestError('Billing is not enabled');
    }

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is a member
    const membership = await getOrganizationMembership(org.id, user.id);
    if (!membership) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // Get full org details for trial info and effective plan
    const orgDetails = await getOrganizationDetails(org.id);
    if (!orgDetails) {
      throw new NotFoundError('Organization not found');
    }

    const prices = getAvailablePrices();
    const trialInfo = getTrialInfo(org);

    return sendData(reply, {
      plan: org.plan,
      effectivePlan: orgDetails.effectivePlan,
      billingStatus: null, // No subscription status for orgs without stripe subscription
      stripeCustomerId: org.stripeCustomerId,
      subscription: null, // TODO: add org subscription lookup if needed
      trial: {
        status: trialInfo.status,
        startedAt: trialInfo.startedAt?.toISOString() || null,
        endsAt: trialInfo.endsAt?.toISOString() || null,
        convertedAt: trialInfo.convertedAt?.toISOString() || null,
        daysRemaining: trialInfo.daysRemaining,
        trialDurationDays: TRIAL_DURATION_DAYS,
      },
      prices: prices?.team ? {
        monthly: {
          id: prices.team.monthly,
          price: 2900, // $29.00 in cents
          interval: 'month',
        },
        yearly: {
          id: prices.team.yearly,
          price: 29000, // $290.00 in cents
          interval: 'year',
        },
      } : null,
    }, { requestId: request.id });
  });

  /**
   * POST /:org/billing/checkout
   * Create a checkout session for organization subscription (org owner only)
   */
  fastify.post<{
    Params: { org: string };
    Body: { priceId: string; successUrl: string; cancelUrl: string };
  }>('/:org/billing/checkout', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const { priceId, successUrl, cancelUrl } = request.body;
    const vcsUser = request.vcsUser || request.githubUser!;

    if (!isStripeEnabled()) {
      throw new BadRequestError('Billing is not enabled');
    }

    // Validate body
    const bodySchema = z.object({
      priceId: z.string().min(1),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    });

    bodySchema.parse({ priceId, successUrl, cancelUrl });

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is org owner
    const isOwner = await isOrganizationOwner(org.id, user.id);
    if (!isOwner) {
      throw new ForbiddenError('Only organization owners can manage billing');
    }

    // Create checkout session
    const sessionUrl = await createOrgCheckoutSession(
      org.id,
      org.login,
      user.email || vcsUser.email || '',
      priceId,
      successUrl,
      cancelUrl
    );

    return sendData(reply, { url: sessionUrl }, { requestId: request.id });
  });

  /**
   * POST /:org/billing/portal
   * Create a customer portal session for organization (org owner only)
   */
  fastify.post<{
    Params: { org: string };
    Body: { returnUrl: string };
  }>('/:org/billing/portal', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const { returnUrl } = request.body;
    const vcsUser = request.vcsUser || request.githubUser!;

    if (!isStripeEnabled()) {
      throw new BadRequestError('Billing is not enabled');
    }

    // Validate body
    const bodySchema = z.object({
      returnUrl: z.string().url(),
    });

    bodySchema.parse({ returnUrl });

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is org owner
    const isOwner = await isOrganizationOwner(org.id, user.id);
    if (!isOwner) {
      throw new ForbiddenError('Only organization owners can manage billing');
    }

    // Create portal session
    const portalUrl = await createOrgPortalSession(org.id, returnUrl);

    return sendData(reply, { url: portalUrl }, { requestId: request.id });
  });

  // =========================================================================
  // Trial Routes
  // =========================================================================

  /**
   * GET /:org/trial
   * Get trial status for an organization
   */
  fastify.get<{
    Params: { org: string };
  }>('/:org/trial', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is a member
    const membership = await getOrganizationMembership(org.id, user.id);
    if (!membership) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const trialInfo = getTrialInfo(org);

    return sendData(reply, {
      ...trialInfo,
      trialDurationDays: TRIAL_DURATION_DAYS,
      startedAt: trialInfo.startedAt?.toISOString() || null,
      endsAt: trialInfo.endsAt?.toISOString() || null,
      convertedAt: trialInfo.convertedAt?.toISOString() || null,
    }, { requestId: request.id });
  });

  /**
   * POST /:org/trial/start
   * Start a Team trial for an organization (org owner only)
   */
  fastify.post<{
    Params: { org: string };
  }>('/:org/trial/start', {
    preHandler: [authenticateGitHub],
  }, async (request, reply) => {
    const { org: orgLogin } = request.params;
    const vcsUser = request.vcsUser || request.githubUser!;

    // Get user from database
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.forgeType, vcsUser.forgeType),
        eq(users.forgeUserId, vcsUser.forgeUserId)
      ),
    });

    if (!user) {
      throw new ForbiddenError('User not found');
    }

    // Get organization by login
    const org = await getOrganizationByLogin(orgLogin);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user can start a trial
    // First try Keyway DB (org owner)
    const membership = await getOrganizationMembership(org.id, user.id);
    let canStartTrial = membership?.orgRole === 'owner';

    // If not owner in DB, check if GitHub App is installed for this org
    // Having the app installed implies admin access was granted
    if (!canStartTrial) {
      const installation = await db.query.vcsAppInstallations.findFirst({
        where: and(
          eq(vcsAppInstallations.accountLogin, orgLogin),
          eq(vcsAppInstallations.status, 'active')
        ),
      });

      // If app is installed, user likely has admin access (they installed it or have org access)
      canStartTrial = !!installation;
    }

    if (!canStartTrial) {
      throw new ForbiddenError('GitHub App must be installed for this organization');
    }

    // Start the trial
    const result = await startTrial({
      orgId: org.id,
      userId: user.id,
      platform: detectPlatform(request),
    });

    if (!result.success) {
      throw new BadRequestError(result.error || 'Failed to start trial');
    }

    const updatedOrg = result.organization!;
    const trialInfo = getTrialInfo(updatedOrg);

    return sendData(reply, {
      message: `Trial started! You have ${TRIAL_DURATION_DAYS} days to try the Team plan.`,
      trial: {
        ...trialInfo,
        startedAt: trialInfo.startedAt?.toISOString() || null,
        endsAt: trialInfo.endsAt?.toISOString() || null,
        convertedAt: trialInfo.convertedAt?.toISOString() || null,
      },
    }, { requestId: request.id });
  });
}
