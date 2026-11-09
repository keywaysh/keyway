import { db, organizations, organizationMembers, users } from "../db";
import { eq, and } from "drizzle-orm";
import type { Organization, UserPlan } from "../db/schema";
import { logActivity } from "./activity.service";
import type { ActivityPlatform } from "../db/schema";
import { planRank } from "../config/plans";
import { isLiveOrgAdmin } from "../utils/orgAdmin";
import type { ForgeAccount } from "../utils/forgeAccount";

// ============================================================================
// Constants
// ============================================================================

/** Default trial duration in days */
export const TRIAL_DURATION_DAYS = 15;

// ============================================================================
// Types
// ============================================================================

export type TrialStatus = "none" | "active" | "expired" | "converted";

export interface TrialInfo {
  status: TrialStatus;
  startedAt: Date | null;
  endsAt: Date | null;
  convertedAt: Date | null;
  daysRemaining: number | null;
}

// ============================================================================
// Trial Status Helpers
// ============================================================================

/**
 * Get trial information for an organization
 */
export function getTrialInfo(org: Organization): TrialInfo {
  const now = new Date();

  // No trial ever started
  if (!org.trialStartedAt) {
    return {
      status: "none",
      startedAt: null,
      endsAt: null,
      convertedAt: null,
      daysRemaining: null,
    };
  }

  // Trial was converted to paid
  if (org.trialConvertedAt) {
    return {
      status: "converted",
      startedAt: org.trialStartedAt,
      endsAt: org.trialEndsAt,
      convertedAt: org.trialConvertedAt,
      daysRemaining: null,
    };
  }

  // Trial is active or expired
  if (org.trialEndsAt) {
    const isActive = org.trialEndsAt > now;
    const daysRemaining = isActive
      ? Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      status: isActive ? "active" : "expired",
      startedAt: org.trialStartedAt,
      endsAt: org.trialEndsAt,
      convertedAt: null,
      daysRemaining: isActive ? daysRemaining : null,
    };
  }

  // Shouldn't happen, but handle edge case
  return {
    status: "none",
    startedAt: org.trialStartedAt,
    endsAt: null,
    convertedAt: null,
    daysRemaining: null,
  };
}

/**
 * Check if an organization is on an active trial
 */
export function isTrialActive(org: Organization): boolean {
  return getTrialInfo(org).status === "active";
}

/**
 * Check if an organization's trial has expired (and not converted)
 */
export function isTrialExpired(org: Organization): boolean {
  return getTrialInfo(org).status === "expired";
}

/**
 * Check if an organization has ever had a trial
 */
export function hasHadTrial(org: Organization): boolean {
  return org.trialStartedAt !== null;
}

/**
 * True when the org's Team/Business plan comes from a Stripe subscription.
 *
 * `org.plan` is written by two things: startTrial ("business" for the trial) and
 * the subscription webhook (only while the subscription is active/trialing/
 * past_due). Outside a trial, or once a live subscription converted it, the plan
 * is the webhook's. `stripeCustomerId` is NOT evidence of payment: the customer
 * is created when checkout opens, before anything is paid.
 */
export function hasPaidOrgSubscription(org: Organization): boolean {
  const status = getTrialInfo(org).status;
  return (
    (status === "none" || status === "converted") &&
    (org.plan === "team" || org.plan === "business")
  );
}

// ============================================================================
// Trial Operations
// ============================================================================

export interface StartTrialInput {
  orgId: string;
  userId: string;
  platform: ActivityPlatform;
  durationDays?: number;
}

export interface StartTrialResult {
  success: boolean;
  organization?: Organization;
  error?: string;
}

/**
 * Start a Team trial for an organization
 *
 * Rules:
 * - Organization must not already be on Team plan with Stripe
 * - Organization must not have had a trial before
 */
export async function startTrial(input: StartTrialInput): Promise<StartTrialResult> {
  const { orgId, userId, platform, durationDays = TRIAL_DURATION_DAYS } = input;

  // Get the organization
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  // Check if already on a paid plan (Team or Business)
  if (hasPaidOrgSubscription(org)) {
    return { success: false, error: "Organization already has a paid plan" };
  }

  // Check if already had a trial
  if (hasHadTrial(org)) {
    return { success: false, error: "Organization has already used their trial" };
  }

  // Calculate trial dates
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Start the trial
  const [updated] = await db
    .update(organizations)
    .set({
      plan: "business",
      trialStartedAt: now,
      trialEndsAt,
      updatedAt: now,
    })
    .where(eq(organizations.id, orgId))
    .returning();

  // Log activity
  await logActivity({
    userId,
    action: "org_trial_started",
    platform,
    metadata: {
      orgId,
      orgLogin: org.login,
      trialDurationDays: durationDays,
      trialEndsAt: trialEndsAt.toISOString(),
    },
  });

  return { success: true, organization: updated };
}

export interface ConvertTrialInput {
  orgId: string;
  /** null for a system action (Stripe webhook): activity_logs.user_id references users */
  userId: string | null;
  platform: ActivityPlatform;
  stripeCustomerId: string;
}

/**
 * Convert a trial to a paid Team subscription
 * Called when Stripe subscription is successfully created
 */
export async function convertTrial(input: ConvertTrialInput): Promise<StartTrialResult> {
  const { orgId, userId, platform, stripeCustomerId } = input;

  // Get the organization
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  // Check if trial was started
  if (!org.trialStartedAt) {
    return { success: false, error: "Organization is not on a trial" };
  }

  // Already converted
  if (org.trialConvertedAt) {
    return { success: false, error: "Trial has already been converted" };
  }

  const now = new Date();

  // Convert the trial
  const [updated] = await db
    .update(organizations)
    .set({
      stripeCustomerId,
      trialConvertedAt: now,
      updatedAt: now,
    })
    .where(eq(organizations.id, orgId))
    .returning();

  // Log activity
  await logActivity({
    userId,
    action: "org_trial_converted",
    platform,
    metadata: {
      orgId,
      orgLogin: org.login,
      stripeCustomerId,
      daysUsed: Math.ceil((now.getTime() - org.trialStartedAt.getTime()) / (1000 * 60 * 60 * 24)),
    },
  });

  return { success: true, organization: updated };
}

export interface ExpireTrialInput {
  orgId: string;
  reason?: string;
}

/**
 * Expire a trial (called by cron job or manually)
 * Sets plan back to 'free'
 */
export async function expireTrial(input: ExpireTrialInput): Promise<StartTrialResult> {
  const { orgId, reason } = input;

  // Get the organization
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  // Check if trial was started
  if (!org.trialStartedAt) {
    return { success: false, error: "Organization is not on a trial" };
  }

  // Already converted - don't expire
  if (org.trialConvertedAt) {
    return { success: false, error: "Trial has already been converted to paid" };
  }

  const now = new Date();

  // Set plan back to free (keep trial dates for history)
  const [updated] = await db
    .update(organizations)
    .set({
      plan: "free",
      updatedAt: now,
    })
    .where(eq(organizations.id, orgId))
    .returning();

  // Log activity (system action, no user)
  await logActivity({
    userId: org.id, // Use org ID as actor for system actions
    action: "org_trial_expired",
    platform: "api",
    metadata: {
      orgId,
      orgLogin: org.login,
      reason: reason || "Trial period ended",
      trialDurationDays: Math.ceil(
        (now.getTime() - org.trialStartedAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
    },
  });

  return { success: true, organization: updated };
}

// ============================================================================
// Effective Plan for Organization with Trial
// ============================================================================

/**
 * Get the effective plan for an organization considering trial status.
 * Evaluated at read time, so it holds whether or not expireTrial() ever ran.
 *
 * Logic:
 * - Trial active -> 'business'
 * - Trial expired and never converted -> 'free', whatever org.plan says (it
 *   still holds the trial's "business"). A subscription that went live converts
 *   the trial (billing webhook), so a paying org is never in this state.
 * - No trial, or trial converted -> org.plan, which the subscription webhook
 *   keeps in sync with the Stripe subscription (paid tier only while entitled).
 *
 * `stripeCustomerId` is deliberately ignored: it is set when checkout opens,
 * before any payment, so "customer id + business plan" proved nothing.
 */
export function getEffectivePlanWithTrial(org: Organization): UserPlan {
  switch (getTrialInfo(org).status) {
    case "active":
      return "business";
    case "expired":
      return "free";
    default:
      return org.plan;
  }
}

// ============================================================================
// Effective Plan for User (across all their orgs)
// ============================================================================

/**
 * How long a live GitHub confirmation that a user owns an org is trusted.
 * `organization_members.org_role` is only a mirror (GitHub sends no webhook
 * when an admin is demoted), so it never grants on its own: a removed or
 * demoted owner loses the org's tier within this window.
 */
export const ORG_OWNER_VERIFICATION_TTL_MS = 5 * 60 * 1000;

/**
 * How long a refusal (not an admin, or GitHub couldn't confirm) is remembered:
 * short, so a transient GitHub failure recovers quickly, but enough to keep an
 * outage or a missing installation from costing a GitHub call per request.
 */
const ORG_OWNER_REFUSAL_TTL_MS = 60 * 1000;

/** Bound on remembered verifications (oldest dropped first). */
const MAX_ORG_OWNER_VERIFICATIONS = 10_000;

/**
 * Per-process: each instance confirms on its own, so staleness is bounded by
 * the TTL everywhere and nothing needs a schema change or shared store.
 */
const orgOwnerVerifications = new Map<string, { owner: boolean; expiresAt: number }>();

/** Forget every remembered verification (tests). */
export function clearOrgOwnerVerifications(): void {
  orgOwnerVerifications.clear();
}

/**
 * True only when GitHub confirmed, within ORG_OWNER_VERIFICATION_TTL_MS, that
 * the account is an admin of the org (bound to the org's and the account's
 * immutable GitHub ids, see utils/orgAdmin). Anything else, errors included,
 * is a refusal.
 */
async function isVerifiedOrgOwner(
  userId: string,
  org: Organization,
  account: ForgeAccount
): Promise<boolean> {
  if (org.forgeType !== "github") {
    return false;
  }
  const key = `${userId}:${org.id}`;
  const now = Date.now();
  const remembered = orgOwnerVerifications.get(key);
  if (remembered && remembered.expiresAt > now) {
    return remembered.owner;
  }

  let owner = false;
  try {
    owner = await isLiveOrgAdmin(org, account);
  } catch {
    owner = false;
  }

  orgOwnerVerifications.delete(key);
  if (orgOwnerVerifications.size >= MAX_ORG_OWNER_VERIFICATIONS) {
    const oldest = orgOwnerVerifications.keys().next().value;
    if (oldest !== undefined) {
      orgOwnerVerifications.delete(oldest);
    }
  }
  orgOwnerVerifications.set(key, {
    owner,
    expiresAt: now + (owner ? ORG_OWNER_VERIFICATION_TTL_MS : ORG_OWNER_REFUSAL_TTL_MS),
  });
  return owner;
}

/**
 * Get the effective plan for a user, considering:
 * - User's personal plan
 * - Any organization the user owns, as confirmed live by GitHub (orgs grant
 *   their tier, e.g. Business, to their owners)
 *
 * Returns the highest-ranked plan the user has access to via any path, so that
 * hierarchical feature gates (e.g. Exposure on Business) resolve correctly.
 *
 * Cheap on hot paths: only orgs that would raise the plan are checked, best
 * first, stopping at the first one GitHub confirms, and a confirmation is
 * reused for ORG_OWNER_VERIFICATION_TTL_MS. Fails closed: if GitHub can't
 * confirm, the user keeps only their own plan.
 */
export async function getEffectivePlanForUser(userId: string): Promise<UserPlan> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { plan: true, username: true, forgeUserId: true, forgeType: true },
  });
  if (!user) {
    return "free";
  }

  let best: UserPlan = user.plan;

  // Cached owner rows are only candidates: each grant is confirmed on GitHub.
  const ownedOrgs = await db.query.organizationMembers.findMany({
    where: and(eq(organizationMembers.userId, userId), eq(organizationMembers.orgRole, "owner")),
    with: {
      organization: true,
    },
  });

  const candidates = ownedOrgs
    .flatMap((membership) =>
      membership.organization
        ? [
            {
              org: membership.organization,
              plan: getEffectivePlanWithTrial(membership.organization),
            },
          ]
        : []
    )
    .filter((candidate) => planRank(candidate.plan) > planRank(best))
    .sort((a, b) => planRank(b.plan) - planRank(a.plan));

  const account: ForgeAccount = {
    username: user.username,
    forgeUserId: user.forgeUserId,
    forgeType: user.forgeType,
  };
  for (const candidate of candidates) {
    if (await isVerifiedOrgOwner(userId, candidate.org, account)) {
      best = candidate.plan;
      break;
    }
  }

  return best;
}
