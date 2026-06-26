import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateGitHub } from "../../../middleware/auth";
import { db, users, vcsAppInstallations } from "../../../db";
import { sendData, NotFoundError, ForbiddenError, BadRequestError } from "../../../lib";
import {
  getOrganizationsForUser,
  getOrganizationByLogin,
  getOrganizationDetails,
  getOrganizationMembersWithGitHub,
  updateOrganization,
  syncOrganizationMembers,
  getOrganizationMembership,
  ensureOrganizationExists,
  upsertOrganizationMember,
} from "../../../services/organization.service";
import { keywayRoleFromGitHub } from "../../../utils/orgRole";
import type { OrgRole } from "../../../db/schema";
import { startTrial, getTrialInfo, TRIAL_DURATION_DAYS } from "../../../services/trial.service";
import { detectPlatform } from "../../../services/activity.service";
import { sendTrialStartedEmail } from "../../../utils/email";
import {
  listOrgMembers,
  listUserOrganizations,
  getOrgMembership,
} from "../../../utils/github";
import {
  getInstallationToken,
  findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI,
} from "../../../services/github-app.service";
import { eq, and } from "drizzle-orm";
import {
  isStripeEnabled,
  createOrgCheckoutSession,
  createOrgPortalSession,
  getAvailablePrices,
  type ResolvedPrice,
} from "../../../services/billing.service";

/**
 * Shape a resolved org tier (monthly + yearly) for the billing API response.
 * Returns null if either interval is missing in Stripe.
 */
function toOrgTierPrices(
  tier?: { monthly: ResolvedPrice | null; yearly: ResolvedPrice | null }
) {
  if (!tier?.monthly || !tier?.yearly) {
    return null;
  }
  const shape = (p: ResolvedPrice) => ({
    id: p.id,
    price: p.amount,
    currency: p.currency,
    interval: p.interval,
  });
  return { monthly: shape(tier.monthly), yearly: shape(tier.yearly) };
}

/**
 * Organization routes
 * GET /api/v1/orgs - List user's organizations
 * GET /api/v1/orgs/:org - Get organization details
 * PUT /api/v1/orgs/:org - Update organization settings
 * GET /api/v1/orgs/:org/members - List organization members
 * POST /api/v1/orgs/:org/members/sync - Force sync members from GitHub
 */

type WarnLogger = { warn: (obj: object, msg: string) => void };

/**
 * Get an App installation token for an org (DB first, then GitHub API fallback).
 * Returns null if the Keyway App isn't installed on the org.
 */
async function getOrgInstallationToken(orgLogin: string): Promise<string | null> {
  let installation = await db.query.vcsAppInstallations.findFirst({
    where: and(
      eq(vcsAppInstallations.accountLogin, orgLogin),
      eq(vcsAppInstallations.accountType, "organization"),
      eq(vcsAppInstallations.status, "active")
    ),
  });
  if (!installation) {
    const apiInstallation = await findOrgInstallationViaGitHubAPI(orgLogin);
    if (apiInstallation) {
      await syncInstallationFromAPI(apiInstallation);
      installation = apiInstallation;
    }
  }
  if (!installation) {
    return null;
  }
  try {
    return await getInstallationToken(installation.installationId);
  } catch {
    return null;
  }
}

/**
 * Refresh the caller's cached org_role from LIVE GitHub — the single primitive
 * for the "GitHub is the source of truth, `organization_members.org_role` is a
 * mirror" invariant.
 *
 * The role is read via the App INSTALLATION token (Members: Read), NOT the user's
 * user-to-server token: the latter does not reliably report the admin role (it
 * returns "member"/none for real org owners), which would wrongly deny admins in
 * production. The username comes from the authenticated session, so it cannot be
 * spoofed by the caller.
 *
 * Returns the live role, or null when it can't be determined (App not installed,
 * caller not an active member, or GitHub unreachable). Self-heals the DB row when
 * it differs from `cachedRole`; the write is non-fatal.
 *
 * Intentionally uncached — one GitHub round-trip per call. Do NOT call on hot paths.
 */
async function refreshCachedOrgRole(
  orgLogin: string,
  orgId: string,
  userId: string,
  username: string,
  cachedRole: OrgRole | undefined,
  log: WarnLogger
): Promise<OrgRole | null> {
  const installToken = await getOrgInstallationToken(orgLogin);
  if (!installToken) {
    return null;
  }
  let live;
  try {
    live = await getOrgMembership(installToken, orgLogin, username);
  } catch {
    return null;
  }
  if (!live || live.state !== "active") {
    return null;
  }
  const role = keywayRoleFromGitHub(live.role);
  if (role !== cachedRole) {
    try {
      await upsertOrganizationMember(orgId, userId, role);
    } catch (err) {
      log.warn({ err, orgId, userId }, "self-heal org role upsert failed");
    }
  }
  return role;
}

/**
 * The single gate for owner-gated org actions: re-check LIVE GitHub admin (via
 * refreshCachedOrgRole, using the installation token). A stale/forged DB owner
 * row must not grant, and a member mis-recorded at connect time must not be
 * wrongly denied (the bootstrap deadlock). Fails closed: not an active admin or
 * GitHub unreachable → ForbiddenError. Keep PUT/sync/billing/trial routed through
 * here so the boundary lives in one place.
 */
async function requireLiveOrgAdmin(
  orgLogin: string,
  orgId: string,
  userId: string,
  username: string,
  action: string,
  log: WarnLogger
): Promise<void> {
  const role = await refreshCachedOrgRole(orgLogin, orgId, userId, username, undefined, log);
  if (role !== "owner") {
    throw new ForbiddenError(`Only organization admins can ${action}`);
  }
}

export async function organizationsRoutes(fastify: FastifyInstance) {
  /**
   * GET /
   * List all organizations the user belongs to
   */
  fastify.get(
    "/",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
    }
  );

  /**
   * POST /connect
   * Connect a GitHub organization to Keyway
   * Creates the org in DB and adds user as member
   */
  fastify.post<{
    Body: { orgLogin: string };
  }>(
    "/connect",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // SECURITY: Verify user has access to this organization via GitHub App installations
      // The /user/installations endpoint only returns orgs where:
      // 1. The GitHub App is installed
      // 2. The user has authorized the app and has access to the org
      const accessToken = request.accessToken;
      if (!accessToken) {
        throw new ForbiddenError("Access token required");
      }

      const userOrgs = await listUserOrganizations(accessToken);
      const targetOrg = userOrgs.find((org) => org.login.toLowerCase() === orgLogin.toLowerCase());
      if (!targetOrg) {
        throw new ForbiddenError(
          "You do not have access to this organization or the Keyway app is not installed"
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
          return sendData(
            reply,
            {
              organization: details,
              message: "Organization already connected",
            },
            { requestId: request.id }
          );
        }
        // Org exists but the caller isn't a member yet — they're added below,
        // after resolving the authoritative role (shared with the create path).
      }

      // Check if GitHub App is installed on this org (check DB first, then GitHub API)
      let installation = await db.query.vcsAppInstallations.findFirst({
        where: and(
          eq(vcsAppInstallations.accountLogin, orgLogin),
          eq(vcsAppInstallations.accountType, "organization"),
          eq(vcsAppInstallations.status, "active")
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
          "GitHub App is not installed on this organization. " +
            "Please install the Keyway GitHub App first."
        );
      }

      // Get installation token to fetch org info
      const installToken = await getInstallationToken(installation.installationId);

      // Resolve the caller's role authoritatively via the installation token
      // (Members: Read) for BOTH the add-to-existing and create paths, rather
      // than trusting targetOrg.role from the user-to-server token — that read
      // can silently fail and demote a real owner to "member". Fall back to the
      // user-token-derived role on failure.
      let keywayRole: OrgRole = keywayRoleFromGitHub(targetOrg.role);
      try {
        const authoritative = await getOrgMembership(installToken, orgLogin, user.username);
        if (authoritative?.role) {
          keywayRole = keywayRoleFromGitHub(authoritative.role);
        }
      } catch {
        // Keep the user-token-derived role if the authoritative read fails.
      }

      // Existing org the caller isn't a member of yet → add them with the role.
      if (existingOrg) {
        await upsertOrganizationMember(existingOrg.id, user.id, keywayRole);
        const details = await getOrganizationDetails(existingOrg.id);
        return sendData(
          reply,
          { organization: details, message: "Connected to organization" },
          { requestId: request.id }
        );
      }

      // New org → create it with the resolved role.
      const org = await ensureOrganizationExists(orgLogin, installToken, {
        userId: user.id,
        keywayRole,
      });

      if (!org) {
        throw new BadRequestError(
          "Could not connect to organization. Please ensure it is a valid GitHub organization."
        );
      }

      // Get full details
      const details = await getOrganizationDetails(org.id);

      return sendData(
        reply,
        {
          organization: details,
          message: "Organization connected successfully",
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /:org
   * Get organization details by login
   */
  fastify.get<{
    Params: { org: string };
  }>(
    "/:org",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Check if user is a member
      const membership = await getOrganizationMembership(org.id, user.id);
      if (!membership) {
        throw new ForbiddenError("You are not a member of this organization");
      }

      // Self-heal the caller's role from live GitHub. The cached org_role can go
      // stale — e.g. it's set to "member" at connect time if the App didn't yet
      // have the org Members permission to read the real role. GitHub is the
      // source of truth, so refresh the cache on access. Non-fatal on failure.
      const role =
        (await refreshCachedOrgRole(
          orgLogin,
          org.id,
          user.id,
          user.username,
          membership.orgRole,
          request.log
        )) ?? membership.orgRole;

      // Get full details
      const details = await getOrganizationDetails(org.id);
      return sendData(
        reply,
        {
          ...details,
          role, // Current user's role, refreshed from GitHub above
          trialDurationDays: TRIAL_DURATION_DAYS, // For "Start X-day trial" display
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * PUT /:org
   * Update organization settings (org owner only)
   */
  fastify.put<{
    Params: { org: string };
    Body: { displayName?: string; defaultPermissions?: Record<string, unknown> };
  }>(
    "/:org",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Authorization: require live GitHub admin. defaultPermissions can grant
      // write to every vault in the org, so a stale/forged DB owner row must not
      // suffice. Fails closed if GitHub is unreachable; legitimate admins retry.
      await requireLiveOrgAdmin(
        orgLogin,
        org.id,
        user.id,
        user.username,
        "update settings",
        request.log
      );

      // Update organization
      const updated = await updateOrganization(org.id, validatedBody);
      return sendData(
        reply,
        {
          id: updated.id,
          login: updated.login,
          displayName: updated.displayName,
          defaultPermissions: updated.defaultPermissions,
          updatedAt: updated.updatedAt.toISOString(),
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /:org/members
   * List organization members
   */
  fastify.get<{
    Params: { org: string };
  }>(
    "/:org/members",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Check if user is a member
      const membership = await getOrganizationMembership(org.id, user.id);
      if (!membership) {
        throw new ForbiddenError("You are not a member of this organization");
      }

      // Installation token returns the full roster; the user token under-reports in prod.
      const installToken = await getOrgInstallationToken(orgLogin);
      const members = await getOrganizationMembersWithGitHub(
        { id: org.id, login: org.login },
        installToken ?? request.accessToken
      );
      return sendData(reply, members, { requestId: request.id });
    }
  );

  /**
   * POST /:org/members/sync
   * Force sync members from GitHub (org owner only)
   */
  fastify.post<{
    Params: { org: string };
  }>(
    "/:org/members/sync",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      await requireLiveOrgAdmin(orgLogin, org.id, user.id, user.username, "sync members", request.log);

      // Sync against the installation-token roster (full + reliable), not the user token.
      const installToken = await getOrgInstallationToken(orgLogin);
      if (!installToken) {
        throw new ForbiddenError("Keyway App is not installed on this organization");
      }
      const githubMembers = await listOrgMembers(installToken, orgLogin);

      // Convert GitHub members to VCS format (id as string)
      const vcsMembers = githubMembers.map((m) => ({
        id: String(m.id),
        login: m.login,
        avatar_url: m.avatar_url,
        role: m.role,
      }));

      // Sync with database
      const result = await syncOrganizationMembers(org.id, "github", vcsMembers);

      return sendData(
        reply,
        {
          message: "Members synced successfully",
          ...result,
        },
        { requestId: request.id }
      );
    }
  );

  // =========================================================================
  // Billing Routes
  // =========================================================================

  /**
   * GET /:org/billing
   * Get organization billing status
   */
  fastify.get<{
    Params: { org: string };
  }>(
    "/:org/billing",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { org: orgLogin } = request.params;
      const vcsUser = request.vcsUser || request.githubUser!;

      if (!isStripeEnabled()) {
        throw new BadRequestError("Billing is not enabled");
      }

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Check if user is a member
      const membership = await getOrganizationMembership(org.id, user.id);
      if (!membership) {
        throw new ForbiddenError("You are not a member of this organization");
      }

      // Get full org details for trial info and effective plan
      const orgDetails = await getOrganizationDetails(org.id);
      if (!orgDetails) {
        throw new NotFoundError("Organization not found");
      }

      const prices = await getAvailablePrices();
      const trialInfo = getTrialInfo(org);

      return sendData(
        reply,
        {
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
          // Organizations can subscribe to Team or Business. Amounts/currency
          // come straight from Stripe (resolved via lookup_keys).
          prices: {
            team: toOrgTierPrices(prices?.team),
            business: toOrgTierPrices(prices?.business),
          },
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /:org/billing/checkout
   * Create a checkout session for organization subscription (org owner only)
   */
  fastify.post<{
    Params: { org: string };
    Body: { priceId: string; successUrl: string; cancelUrl: string };
  }>(
    "/:org/billing/checkout",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { org: orgLogin } = request.params;
      const { priceId, successUrl, cancelUrl } = request.body;
      const vcsUser = request.vcsUser || request.githubUser!;

      if (!isStripeEnabled()) {
        throw new BadRequestError("Billing is not enabled");
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      await requireLiveOrgAdmin(orgLogin, org.id, user.id, user.username, "manage billing", request.log);

      // Guard against creating a second subscription: an org already paying must
      // change plans via the portal. Exclude active trials (their plan is 'business'
      // and a Stripe customer may exist from an abandoned checkout, but they still
      // need to be able to convert to a paid subscription).
      if (
        org.stripeCustomerId &&
        (org.plan === "team" || org.plan === "business") &&
        getTrialInfo(org).status !== "active"
      ) {
        throw new BadRequestError(
          "Organization already has an active subscription. Use the billing portal to change plans."
        );
      }

      // Create checkout session
      const sessionUrl = await createOrgCheckoutSession(
        org.id,
        org.login,
        user.email || vcsUser.email || "",
        priceId,
        successUrl,
        cancelUrl
      );

      return sendData(reply, { url: sessionUrl }, { requestId: request.id });
    }
  );

  /**
   * POST /:org/billing/portal
   * Create a customer portal session for organization (org owner only)
   */
  fastify.post<{
    Params: { org: string };
    Body: { returnUrl: string };
  }>(
    "/:org/billing/portal",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { org: orgLogin } = request.params;
      const { returnUrl } = request.body;
      const vcsUser = request.vcsUser || request.githubUser!;

      if (!isStripeEnabled()) {
        throw new BadRequestError("Billing is not enabled");
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      await requireLiveOrgAdmin(orgLogin, org.id, user.id, user.username, "manage billing", request.log);

      // Create portal session
      const portalUrl = await createOrgPortalSession(org.id, returnUrl);

      return sendData(reply, { url: portalUrl }, { requestId: request.id });
    }
  );

  // =========================================================================
  // Trial Routes
  // =========================================================================

  /**
   * GET /:org/trial
   * Get trial status for an organization
   */
  fastify.get<{
    Params: { org: string };
  }>(
    "/:org/trial",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Check if user is a member
      const membership = await getOrganizationMembership(org.id, user.id);
      if (!membership) {
        throw new ForbiddenError("You are not a member of this organization");
      }

      const trialInfo = getTrialInfo(org);

      return sendData(
        reply,
        {
          ...trialInfo,
          trialDurationDays: TRIAL_DURATION_DAYS,
          startedAt: trialInfo.startedAt?.toISOString() || null,
          endsAt: trialInfo.endsAt?.toISOString() || null,
          convertedAt: trialInfo.convertedAt?.toISOString() || null,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * POST /:org/trial/start
   * Start a Team trial for an organization (org owner only)
   */
  fastify.post<{
    Params: { org: string };
  }>(
    "/:org/trial/start",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
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
        throw new ForbiddenError("User not found");
      }

      // Get organization by login
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      await requireLiveOrgAdmin(orgLogin, org.id, user.id, user.username, "start a trial", request.log);

      // Start the trial
      const result = await startTrial({
        orgId: org.id,
        userId: user.id,
        platform: detectPlatform(request),
      });

      if (!result.success) {
        throw new BadRequestError(result.error || "Failed to start trial");
      }

      const updatedOrg = result.organization!;
      const trialInfo = getTrialInfo(updatedOrg);

      // Send trial started email (fire and forget)
      if (user.email) {
        sendTrialStartedEmail({
          to: user.email,
          username: user.username,
          orgName: org.login,
          trialDays: TRIAL_DURATION_DAYS,
          trialEndsAt: updatedOrg.trialEndsAt!,
        });
      }

      return sendData(
        reply,
        {
          message: `Trial started! You have ${TRIAL_DURATION_DAYS} days to try the Team plan.`,
          trial: {
            ...trialInfo,
            startedAt: trialInfo.startedAt?.toISOString() || null,
            endsAt: trialInfo.endsAt?.toISOString() || null,
            convertedAt: trialInfo.convertedAt?.toISOString() || null,
          },
        },
        { requestId: request.id }
      );
    }
  );
}
