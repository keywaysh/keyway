import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateGitHub, rejectApiKeyAuth } from "../../../middleware/auth";
import { config } from "../../../config";
import { isAllowedOrigin } from "../../../utils/origins";
import { db, users, vcsAppInstallations } from "../../../db";
import {
  sendData,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
  type ApiError,
} from "../../../lib";
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
  removeOrganizationMember,
} from "../../../services/organization.service";
import type {
  OrgRole,
  Organization,
  OrganizationMember,
  VcsAppInstallation,
} from "../../../db/schema";
import {
  startTrial,
  getTrialInfo,
  hasPaidOrgSubscription,
  TRIAL_DURATION_DAYS,
} from "../../../services/trial.service";
import { detectPlatform } from "../../../services/activity.service";
import { sendTrialStartedEmail } from "../../../utils/email";
import { listOrgMembers, listUserOrganizations } from "../../../utils/github";
import {
  findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI,
} from "../../../services/github-app.service";
import {
  getOrgInstallationToken,
  readLiveOrgMembership,
  type OrgIdentity,
  type UnverifiableReason,
} from "../../../utils/orgAdmin";
import { eq, and } from "drizzle-orm";
import {
  isStripeEnabled,
  createOrgCheckoutSession,
  createOrgPortalSession,
  getAvailablePrices,
  type ResolvedPrice,
} from "../../../services/billing.service";

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
 * Mutating org routes (connect, settings, member sync, trial, billing) act with
 * the caller's full GitHub identity, and no API key scope covers them (scopes
 * only cover secrets and API-key management), so a leaked CI key must not be
 * able to rewrite org defaultPermissions or open a billing portal: require an
 * interactive (JWT/session) login.
 */
const rejectApiKeys = rejectApiKeyAuth("manage organizations");

const NOT_A_MEMBER = "You are not a member of this organization";

/** Actionable refusal for when GitHub can't confirm a membership either way. */
function membershipUnverifiedError(orgLogin: string, reason: UnverifiableReason): ApiError {
  const prefix = `Keyway can't verify your membership of ${orgLogin}`;
  switch (reason) {
    case "missing_permission":
      return new ForbiddenError(
        `${prefix}: the Keyway GitHub App needs the "Members: read" organization permission on ${orgLogin}. ` +
          "Ask an organization owner to approve it in the App's installation settings, then retry."
      );
    case "app_not_installed":
      return new ForbiddenError(
        `${prefix}: the Keyway GitHub App is not installed on this GitHub organization. ` +
          "Ask an organization owner to install it, then retry."
      );
    case "unavailable":
      return new ServiceUnavailableError(`${prefix}: GitHub is unreachable right now. Please retry.`);
  }
}

/**
 * The single membership gate for org routes: member-only data (details with
 * member emails, the roster, billing, trial), joining via /connect, and — via
 * requireLiveOrgAdmin — owner actions. `organization_members` is only a mirror
 * of GitHub, so the caller's membership is re-read LIVE (installation token,
 * bound to the org's immutable GitHub id — see utils/orgAdmin):
 *  - active member → self-heal the cached role (if a row exists) and return
 *    the live role;
 *  - GitHub definitively says not a member (404, invitation pending) → delete
 *    the cached row (if any) and refuse;
 *  - GitHub can't answer (App not installed or lacking Members: read, outage)
 *    → keep the row but refuse with an actionable error. Never serve from the
 *    cached row.
 */
async function requireVerifiedOrgMembership(
  org: OrgIdentity,
  user: { id: string; username: string },
  cached: Pick<OrganizationMember, "orgId" | "orgRole"> | null,
  log: WarnLogger,
  notMemberMessage = NOT_A_MEMBER
): Promise<OrgRole> {
  const live = await readLiveOrgMembership(org, user.username);
  if (live.status === "unverifiable") {
    throw membershipUnverifiedError(org.login, live.reason);
  }
  if (live.status === "not_member") {
    if (cached) {
      try {
        await removeOrganizationMember(cached.orgId, user.id);
      } catch (err) {
        log.warn({ err, orgId: cached.orgId, userId: user.id }, "removing stale org member row failed");
      }
    }
    throw new ForbiddenError(notMemberMessage);
  }
  if (cached && cached.orgRole !== live.role) {
    try {
      await upsertOrganizationMember(cached.orgId, user.id, live.role);
    } catch (err) {
      log.warn({ err, orgId: cached.orgId, userId: user.id }, "self-heal org role upsert failed");
    }
  }
  return live.role;
}

/**
 * Member-only org reads: the caller needs a cached member row AND a live,
 * positively verified GitHub membership (see requireVerifiedOrgMembership).
 * Returns the live role.
 */
async function requireOrgMember(
  org: Organization,
  user: { id: string; username: string },
  log: WarnLogger
): Promise<OrgRole> {
  const membership = await getOrganizationMembership(org.id, user.id);
  if (!membership) {
    throw new ForbiddenError(NOT_A_MEMBER);
  }
  return requireVerifiedOrgMembership(org, user, membership, log);
}

/**
 * The Keyway App installation on a GitHub org that has no Keyway row yet, so
 * no stored GitHub org id to bind to: found by login (DB first, then the GitHub
 * API in case the installation webhook was missed). Its account id becomes the
 * org's identity.
 */
async function findInstallationForNewOrg(orgLogin: string): Promise<VcsAppInstallation | null> {
  const stored = await db.query.vcsAppInstallations.findFirst({
    where: and(
      eq(vcsAppInstallations.accountLogin, orgLogin),
      eq(vcsAppInstallations.accountType, "organization"),
      eq(vcsAppInstallations.status, "active")
    ),
  });
  if (stored) {
    return stored;
  }
  const fromApi = await findOrgInstallationViaGitHubAPI(orgLogin);
  if (fromApi) {
    await syncInstallationFromAPI(fromApi);
  }
  return fromApi;
}

/** Stripe redirect targets must be on our own origins (same rule as user billing). */
function assertAllowedRedirectUrls(...urls: string[]): void {
  const allowedOrigins = config.cors.allowedOrigins;
  if (allowedOrigins.length === 0) {
    return;
  }
  if (urls.some((url) => !isAllowedOrigin(url, allowedOrigins))) {
    throw new BadRequestError("Redirect URLs must be from allowed origins");
  }
}

/**
 * The single gate for owner-gated org actions: re-check LIVE GitHub admin
 * through requireVerifiedOrgMembership (installation token bound to the org's
 * GitHub id). A stale/forged DB owner row must not grant, and a member
 * mis-recorded at connect time must not be wrongly denied (the bootstrap
 * deadlock): the cached row self-heals to the live role, and a live admin with
 * no row yet gets one. Fails closed. Keep PUT/sync/billing/trial routed through
 * here so the boundary lives in one place.
 */
async function requireLiveOrgAdmin(
  org: Organization,
  user: { id: string; username: string },
  action: string,
  log: WarnLogger
): Promise<void> {
  const notAdmin = `Only organization admins can ${action}`;
  const membership = await getOrganizationMembership(org.id, user.id);
  const role = await requireVerifiedOrgMembership(org, user, membership, log, notAdmin);
  if (role !== "owner") {
    throw new ForbiddenError(notAdmin);
  }
  if (!membership) {
    try {
      await upsertOrganizationMember(org.id, user.id, role);
    } catch (err) {
      log.warn({ err, orgId: org.id, userId: user.id }, "self-heal org role upsert failed");
    }
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
      preHandler: [authenticateGitHub, rejectApiKeys],
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

      // Pre-filter via the caller's GitHub App installations. NOT proof of org
      // membership: /user/installations also lists installations covering repos
      // where the caller is only an outside collaborator (membership is checked
      // below with the installation token).
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

      // SECURITY: a Keyway org member can read other members' emails, the full
      // roster (incl. concealed members), and billing details, so membership must
      // mirror an ACTIVE GitHub org membership, read with the installation token
      // (Members: Read) — the user-token role from listUserOrganizations()
      // defaults to "member" for outside collaborators. Same rule as every
      // member-gated route, already-connected members included: positively
      // verified, or refused (requireVerifiedOrgMembership).
      const connectRefused =
        "You must be an active member of this GitHub organization to connect it to Keyway";

      const existingOrg = await getOrganizationByLogin(orgLogin);
      if (existingOrg) {
        // Bound to the GitHub org this row was created for (its immutable id):
        // after a rename, whoever re-registers the old login is a different org.
        const membership = await getOrganizationMembership(existingOrg.id, user.id);
        const role = await requireVerifiedOrgMembership(
          existingOrg,
          user,
          membership,
          request.log,
          connectRefused
        );
        if (!membership) {
          await upsertOrganizationMember(existingOrg.id, user.id, role);
        }
        const details = await getOrganizationDetails(existingOrg.id);
        return sendData(
          reply,
          {
            organization: details,
            message: membership ? "Organization already connected" : "Connected to organization",
          },
          { requestId: request.id }
        );
      }

      // Not connected yet: the org's identity is the GitHub org the Keyway App
      // installation on that login belongs to.
      const installation = await findInstallationForNewOrg(orgLogin);
      if (!installation) {
        throw new BadRequestError(
          "GitHub App is not installed on this organization. " +
            "Please install the Keyway GitHub App first."
        );
      }
      const newOrg: OrgIdentity = { login: orgLogin, forgeOrgId: String(installation.accountId) };
      const keywayRole = await requireVerifiedOrgMembership(
        newOrg,
        user,
        null,
        request.log,
        connectRefused
      );

      const installToken = await getOrgInstallationToken(newOrg);
      if (!installToken) {
        throw membershipUnverifiedError(orgLogin, "unavailable");
      }
      // Created without a member: the caller is added only once the row is
      // confirmed to be the installation's GitHub org.
      const org = await ensureOrganizationExists(orgLogin, installToken);

      if (!org) {
        throw new BadRequestError(
          "Could not connect to organization. Please ensure it is a valid GitHub organization."
        );
      }
      if (org.forgeOrgId !== newOrg.forgeOrgId) {
        throw new ConflictError(
          `The GitHub organization named ${orgLogin} is not the one Keyway knows under that name. ` +
            "Contact support to connect it."
        );
      }
      await upsertOrganizationMember(org.id, user.id, keywayRole);

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

      // Member emails: live, positively verified members only. GitHub is the
      // source of truth: the cached role self-heals (it can go stale, e.g.
      // "member" recorded before the App had the Members permission) and the
      // row is dropped if GitHub says the caller is no longer an org member.
      const role = await requireOrgMember(org, user, request.log);

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
      preHandler: [authenticateGitHub, rejectApiKeys],
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
      await requireLiveOrgAdmin(org, user, "update settings", request.log);

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

      // The roster includes concealed members: only live org members may read it.
      await requireOrgMember(org, user, request.log);

      // Installation token returns the full roster; the user token under-reports in prod.
      const installToken = await getOrgInstallationToken(org);
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
      preHandler: [authenticateGitHub, rejectApiKeys],
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

      await requireLiveOrgAdmin(org, user, "sync members", request.log);

      // Sync against the installation-token roster (full + reliable), not the user token.
      const installToken = await getOrgInstallationToken(org);
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

      // Billing details (Stripe customer id): live, verified members only.
      await requireOrgMember(org, user, request.log);

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
      preHandler: [authenticateGitHub, rejectApiKeys],
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
      assertAllowedRedirectUrls(successUrl, cancelUrl);

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

      await requireLiveOrgAdmin(org, user, "manage billing", request.log);

      // Already subscribed = a paid plan written by the subscription webhook. A
      // Stripe customer id alone only means a checkout was opened once: an
      // expired, abandoned trial must still be able to pay.
      if (hasPaidOrgSubscription(org)) {
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
      preHandler: [authenticateGitHub, rejectApiKeys],
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
      assertAllowedRedirectUrls(returnUrl);

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

      await requireLiveOrgAdmin(org, user, "manage billing", request.log);

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

      await requireOrgMember(org, user, request.log);

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
      preHandler: [authenticateGitHub, rejectApiKeys],
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

      await requireLiveOrgAdmin(org, user, "start a trial", request.log);

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
