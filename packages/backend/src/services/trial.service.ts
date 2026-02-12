import { db, organizations, organizationMembers, users } from "../db";
import { eq, and } from "drizzle-orm";
import type { Organization, UserPlan } from "../db/schema";
import { logActivity } from "./activity.service";
import type { ActivityPlatform } from "../db/schema";

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

  // Check if already on paid Team plan
  if (org.plan === "team" && org.stripeCustomerId) {
    return { success: false, error: "Organization already has a paid Team plan" };
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
      plan: "team",
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
  userId: string;
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
 * Get the effective plan for an organization considering trial status
 *
 * Logic:
 * - If org has Stripe customer ID (paid) -> return actual plan
 * - If trial is active -> return 'team'
 * - If trial is expired (not converted) -> return 'free'
 * - Otherwise -> return actual plan
 */
export function getEffectivePlanWithTrial(org: Organization): "free" | "pro" | "team" | "startup" {
  // Paid customer takes precedence
  if (org.stripeCustomerId && org.plan === "team") {
    return "team";
  }

  const trialInfo = getTrialInfo(org);

  switch (trialInfo.status) {
    case "active":
      return "team";
    case "expired":
      return "free";
    case "converted":
      return org.plan;
    default:
      return org.plan;
  }
}

// ============================================================================
// Effective Plan for User (across all their orgs)
// ============================================================================

/**
 * Get the effective plan for a user considering:
 * - User's personal plan
 * - Any organization where user is owner with Team plan
 *
 * Returns 'team' if user has access to team features via any path
 */
export async function getEffectivePlanForUser(userId: string): Promise<UserPlan> {
  // Get user's personal plan
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { plan: true },
  });

  // If user has team plan personally, return it
  if (user?.plan === "team") {
    return "team";
  }

  // Check if user is owner of any org with effective team plan
  const ownedOrgs = await db.query.organizationMembers.findMany({
    where: and(eq(organizationMembers.userId, userId), eq(organizationMembers.orgRole, "owner")),
    with: {
      organization: true,
    },
  });

  for (const membership of ownedOrgs) {
    if (membership.organization) {
      const effectivePlan = getEffectivePlanWithTrial(membership.organization);
      if (effectivePlan === "team") {
        return "team";
      }
    }
  }

  // Fall back to user's personal plan
  return user?.plan ?? "free";
}
