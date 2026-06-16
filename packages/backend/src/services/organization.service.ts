import { db } from "../db";
import { organizations, organizationMembers, users, vaults } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { Organization, OrganizationMember, OrgRole, UserPlan, ForgeType } from "../db/schema";
import {
  getEffectivePlanWithTrial,
  getTrialInfo,
  hasHadTrial,
  TRIAL_DURATION_DAYS,
  type TrialInfo,
} from "./trial.service";
import { getGitHubOrgInfoWithToken, listOrgMembers } from "../utils/github";
import type { GitHubOrgMember } from "../utils/github";
import { logger } from "../utils/sharedLogger";

// ============================================================================
// Types
// ============================================================================

export interface OrganizationInfo {
  id: string;
  forgeType: "github" | "gitlab" | "bitbucket";
  forgeOrgId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
  plan: UserPlan;
  memberCount: number; // Keyway accounts (members table rows)
  vaultCount: number;
  createdAt: string;
}

export interface OrganizationMemberInfo {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  email: string | null;
  orgRole: OrgRole;
  membershipState: string | null;
  joinedAt: string;
}

export interface OrganizationDetails extends OrganizationInfo {
  members: OrganizationMemberInfo[];
  defaultPermissions: Record<string, unknown>;
  stripeCustomerId: string | null;
  trial: TrialInfo;
  effectivePlan: UserPlan;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get or create an organization from VCS data
 */
export async function getOrCreateOrganization(
  forgeType: ForgeType,
  forgeOrgId: string,
  login: string,
  displayName?: string,
  avatarUrl?: string
): Promise<Organization> {
  // Try to find existing org
  const existingOrg = await db.query.organizations.findFirst({
    where: and(eq(organizations.forgeType, forgeType), eq(organizations.forgeOrgId, forgeOrgId)),
  });

  if (existingOrg) {
    // Update if data changed
    if (
      existingOrg.login !== login ||
      existingOrg.displayName !== displayName ||
      existingOrg.avatarUrl !== avatarUrl
    ) {
      const [updated] = await db
        .update(organizations)
        .set({
          login,
          displayName: displayName ?? existingOrg.displayName,
          avatarUrl: avatarUrl ?? existingOrg.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, existingOrg.id))
        .returning();
      return updated;
    }
    return existingOrg;
  }

  // Create new org
  const [newOrg] = await db
    .insert(organizations)
    .values({
      forgeType,
      forgeOrgId,
      login,
      displayName,
      avatarUrl,
    })
    .returning();

  return newOrg;
}

/**
 * Get organization by login (GitHub org name)
 */
export async function getOrganizationByLogin(login: string): Promise<Organization | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.login, login),
  });
  return org ?? null;
}

/**
 * Get organization by ID
 */
export async function getOrganizationById(orgId: string): Promise<Organization | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  return org ?? null;
}

/**
 * Get organization with full details
 */
export async function getOrganizationDetails(orgId: string): Promise<OrganizationDetails | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    with: {
      members: {
        with: {
          user: true,
        },
        orderBy: [desc(organizationMembers.createdAt)],
      },
      vaults: true,
    },
  });

  if (!org) {
    return null;
  }

  return {
    id: org.id,
    forgeType: org.forgeType,
    forgeOrgId: org.forgeOrgId,
    login: org.login,
    displayName: org.displayName,
    avatarUrl: org.avatarUrl,
    plan: org.plan,
    memberCount: org.members.length,
    vaultCount: org.vaults.length,
    members: org.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      email: m.user.email,
      orgRole: m.orgRole,
      membershipState: m.membershipState,
      joinedAt: m.createdAt.toISOString(),
    })),
    defaultPermissions: (org.defaultPermissions as Record<string, unknown>) ?? {},
    stripeCustomerId: org.stripeCustomerId,
    trial: getTrialInfo(org),
    effectivePlan: getEffectivePlanWithTrial(org),
    createdAt: org.createdAt.toISOString(),
  };
}

/**
 * Get all organizations for a user
 */
export async function getOrganizationsForUser(userId: string): Promise<OrganizationInfo[]> {
  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, userId),
    with: {
      organization: {
        with: {
          members: true,
          vaults: true,
        },
      },
    },
    orderBy: [desc(organizationMembers.createdAt)],
  });

  return memberships.map((m) => ({
    id: m.organization.id,
    forgeType: m.organization.forgeType,
    forgeOrgId: m.organization.forgeOrgId,
    login: m.organization.login,
    displayName: m.organization.displayName,
    avatarUrl: m.organization.avatarUrl,
    plan: m.organization.plan,
    memberCount: m.organization.members.length,
    vaultCount: m.organization.vaults.length,
    createdAt: m.organization.createdAt.toISOString(),
  }));
}

/**
 * Update organization settings
 */
export async function updateOrganization(
  orgId: string,
  updates: {
    displayName?: string;
    defaultPermissions?: Record<string, unknown>;
  }
): Promise<Organization> {
  const [updated] = await db
    .update(organizations)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId))
    .returning();

  return updated;
}

/**
 * Update organization plan (called from billing webhook)
 */
export async function updateOrganizationPlan(orgId: string, plan: UserPlan): Promise<void> {
  await db
    .update(organizations)
    .set({ plan, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}

/**
 * Set Stripe customer ID for organization
 */
export async function setOrganizationStripeCustomerId(
  orgId: string,
  stripeCustomerId: string
): Promise<void> {
  await db
    .update(organizations)
    .set({ stripeCustomerId, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}

// ============================================================================
// Member Operations
// ============================================================================

/**
 * Add or update a member in an organization
 */
export async function upsertOrganizationMember(
  orgId: string,
  userId: string,
  orgRole: OrgRole,
  membershipState: string = "active"
): Promise<OrganizationMember> {
  // Check if membership exists
  const existing = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)),
  });

  if (existing) {
    // Update existing membership
    const [updated] = await db
      .update(organizationMembers)
      .set({
        orgRole,
        membershipState,
        updatedAt: new Date(),
      })
      .where(eq(organizationMembers.id, existing.id))
      .returning();
    return updated;
  }

  // Create new membership
  const [newMember] = await db
    .insert(organizationMembers)
    .values({
      orgId,
      userId,
      orgRole,
      membershipState,
    })
    .returning();

  return newMember;
}

/**
 * Remove a member from an organization
 */
export async function removeOrganizationMember(orgId: string, userId: string): Promise<void> {
  await db
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
}

/**
 * Get a user's membership in an organization
 */
export async function getOrganizationMembership(
  orgId: string,
  userId: string
): Promise<OrganizationMember | null> {
  const membership = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)),
  });
  return membership ?? null;
}

/**
 * Check if a user is an owner of an organization
 */
export async function isOrganizationOwner(orgId: string, userId: string): Promise<boolean> {
  const membership = await getOrganizationMembership(orgId, userId);
  return membership?.orgRole === "owner";
}

/**
 * Get all members of an organization
 */
export async function getOrganizationMembers(orgId: string): Promise<OrganizationMemberInfo[]> {
  const members = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.orgId, orgId),
    with: {
      user: true,
    },
    orderBy: [desc(organizationMembers.createdAt)],
  });

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    username: m.user.username,
    avatarUrl: m.user.avatarUrl,
    email: m.user.email,
    orgRole: m.orgRole,
    membershipState: m.membershipState,
    joinedAt: m.createdAt.toISOString(),
  }));
}

export interface OrganizationMemberWithStatus {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: OrgRole;
  // null when the person is a GitHub org member who hasn't signed into Keyway yet
  joinedAt: string | null;
  onKeyway: boolean;
}

/**
 * Synthetic, stable id for a GitHub org member who has no Keyway account yet
 * (used as a list key in the UI). Centralized so the `github:` prefix can't
 * drift between here and anything that pattern-matches it.
 */
export const unclaimedMemberId = (githubUserId: number | string): string =>
  `github:${githubUserId}`;

/**
 * List organization members for display: the full GitHub org membership, each
 * annotated with whether the person already has a Keyway account.
 *
 * GitHub is the source of truth for who belongs to the org. We can only persist
 * a member row once they have a Keyway account (organization_members.user_id is
 * a required FK), so the DB alone under-reports the team. Reading live from
 * GitHub and overlaying the Keyway status gives an accurate roster.
 *
 * The roster is fetched with the CALLER's token so GitHub's own per-user
 * visibility and authorization apply — we never expose members the caller
 * couldn't see on GitHub, and we don't rely on an elevated installation token.
 * Falls back to DB-only members if the live list is unavailable so the page
 * never breaks.
 */
export async function getOrganizationMembersWithGitHub(
  org: { id: string; login: string },
  accessToken: string | undefined
): Promise<OrganizationMemberWithStatus[]> {
  const dbMembers = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.orgId, org.id),
    with: { user: true },
    orderBy: [desc(organizationMembers.createdAt)],
  });
  // Key the overlay on the GitHub numeric id (stored as text). Guard on forge so
  // a non-GitHub member row can never mis-attribute onKeyway/joinedAt.
  const dbByForgeId = new Map(
    dbMembers.filter((m) => m.user.forgeType === "github").map((m) => [m.user.forgeUserId, m])
  );

  let githubMembers: GitHubOrgMember[] = [];
  if (accessToken) {
    try {
      githubMembers = await listOrgMembers(accessToken, org.login);
    } catch (err) {
      logger.warn(
        { org: org.login, error: err instanceof Error ? err.message : "unknown" },
        "Live GitHub member fetch failed; falling back to Keyway-only members"
      );
    }
  }

  // No live roster (no token, no access, or API error) → show what we have.
  if (githubMembers.length === 0) {
    return dbMembers.map((m) => ({
      id: m.id,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      role: m.orgRole,
      joinedAt: m.createdAt.toISOString(),
      onKeyway: true,
    }));
  }

  // GitHub is authoritative for both membership and role. Dedupe by id (a
  // degraded ?role= filter can return overlapping pages) and always take the
  // role from GitHub — the DB org_role can be stale (set once at connect time,
  // never re-synced locally without webhooks).
  const seen = new Set<number>();
  const uniqueMembers = githubMembers.filter((m) => {
    if (seen.has(m.id)) {
      return false;
    }
    seen.add(m.id);
    return true;
  });

  // Overlay Keyway status onto the full GitHub roster. Owners first, then by login.
  return uniqueMembers
    .map((gm): OrganizationMemberWithStatus => {
      const dbm = dbByForgeId.get(String(gm.id));
      return {
        id: dbm ? dbm.id : unclaimedMemberId(gm.id),
        username: gm.login,
        avatarUrl: gm.avatar_url,
        role: gm.role === "admin" ? "owner" : "member",
        joinedAt: dbm ? dbm.createdAt.toISOString() : null,
        onKeyway: Boolean(dbm),
      };
    })
    .sort((a, b) => {
      if (a.role !== b.role) {
        return a.role === "owner" ? -1 : 1;
      }
      return a.username.localeCompare(b.username);
    });
}

// ============================================================================
// Vault Operations
// ============================================================================

/**
 * Associate a vault with an organization
 */
export async function associateVaultWithOrg(vaultId: string, orgId: string): Promise<void> {
  await db.update(vaults).set({ orgId, updatedAt: new Date() }).where(eq(vaults.id, vaultId));
}

/**
 * Get all vaults for an organization
 */
export async function getOrganizationVaults(orgId: string) {
  return db.query.vaults.findMany({
    where: eq(vaults.orgId, orgId),
    with: {
      secrets: true,
    },
    orderBy: [desc(vaults.updatedAt)],
  });
}

// ============================================================================
// VCS Sync Operations
// ============================================================================

export interface VcsOrgMember {
  id: string; // forgeUserId as string
  login: string;
  avatar_url: string;
  role: "admin" | "member";
}

/**
 * Sync organization members from VCS (GitHub, GitLab, etc.)
 * This should be called when:
 * - VCS App is installed on an org
 * - Webhook receives member_added/member_removed event
 * - Manual sync is requested
 */
export async function syncOrganizationMembers(
  orgId: string,
  forgeType: ForgeType,
  vcsMembers: VcsOrgMember[]
): Promise<{ added: number; updated: number; removed: number }> {
  const currentMembers = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.orgId, orgId),
    with: { user: true },
  });

  const _currentMemberUserIds = new Set(currentMembers.map((m) => m.user.forgeUserId));
  const vcsMemberIds = new Set(vcsMembers.map((m) => m.id));

  let added = 0;
  let updated = 0;
  let removed = 0;

  // Add or update members from VCS
  for (const vcsMember of vcsMembers) {
    // Find corresponding Keyway user by forge type and user ID
    const keywayUser = await db.query.users.findFirst({
      where: and(eq(users.forgeType, forgeType), eq(users.forgeUserId, vcsMember.id)),
    });

    if (!keywayUser) {
      // User hasn't logged into Keyway yet, skip
      continue;
    }

    const orgRole: OrgRole = vcsMember.role === "admin" ? "owner" : "member";
    const existingMember = currentMembers.find((m) => m.user.forgeUserId === vcsMember.id);

    if (existingMember) {
      // Update if role changed
      if (existingMember.orgRole !== orgRole) {
        await upsertOrganizationMember(orgId, keywayUser.id, orgRole);
        updated++;
      }
    } else {
      // Add new member
      await upsertOrganizationMember(orgId, keywayUser.id, orgRole);
      added++;
    }
  }

  // Remove members no longer in VCS org
  for (const member of currentMembers) {
    if (!vcsMemberIds.has(member.user.forgeUserId)) {
      await removeOrganizationMember(orgId, member.userId);
      removed++;
    }
  }

  return { added, updated, removed };
}

/**
 * Get the effective plan for a vault (org plan or user plan)
 * Takes into account trial status for organizations
 */
export async function getEffectivePlanForVault(vaultId: string): Promise<UserPlan> {
  const vault = await db.query.vaults.findFirst({
    where: eq(vaults.id, vaultId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!vault) {
    return "free";
  }

  // If vault belongs to an org, use org's effective plan (considering trial)
  if (vault.organization) {
    return getEffectivePlanWithTrial(vault.organization);
  }

  // Otherwise use owner's plan
  return vault.owner.plan;
}

// ============================================================================
// On-Demand Organization Creation
// ============================================================================

export interface TrialEligibility {
  eligible: boolean;
  daysAvailable: number;
  orgLogin: string;
  reason?: string;
}

/**
 * Ensure an organization exists in the database.
 * If it doesn't exist, create it from GitHub data.
 * Also ensures the current user is added as a member.
 *
 * This is called when creating a vault for an org repo to ensure
 * we can properly calculate trial eligibility.
 *
 * @param orgLogin - The GitHub organization login (e.g., "keywaysh")
 * @param token - GitHub installation token to fetch org info
 * @param currentUser - Optional caller info to register as a member.
 *   The caller MUST resolve the user's true GitHub org role
 *   (admin → "owner", member → "member") and pass it explicitly.
 *   Never default to "owner" here — doing so promotes the first
 *   GitHub member who triggers org creation to a Keyway owner.
 * @returns The organization (existing or newly created), or null if not an org
 */
export async function ensureOrganizationExists(
  orgLogin: string,
  token: string,
  currentUser?: { userId: string; keywayRole: "owner" | "member" }
): Promise<Organization | null> {
  // First, check if org already exists in DB
  const existingOrg = await getOrganizationByLogin(orgLogin);
  if (existingOrg) {
    if (currentUser) {
      const membership = await getOrganizationMembership(existingOrg.id, currentUser.userId);
      // Intentionally insert-only: never rewrite an EXISTING member's role here.
      // A connect/vault-create flow must not silently change roles. Role drift is
      // reconciled elsewhere — the GET /:org self-heal (caller's own role) and the
      // webhook member sync (org-wide). Don't "fix" this into an unconditional
      // upsert, or it becomes a privilege-escalation vector.
      if (!membership) {
        await upsertOrganizationMember(
          existingOrg.id,
          currentUser.userId,
          currentUser.keywayRole
        );
      }
    }
    return existingOrg;
  }

  // Fetch org info from GitHub
  const githubOrg = await getGitHubOrgInfoWithToken(token, orgLogin);
  if (!githubOrg) {
    // Not a GitHub organization or not accessible
    return null;
  }

  // Create the organization in DB
  const org = await getOrCreateOrganization(
    "github",
    String(githubOrg.id),
    githubOrg.login,
    githubOrg.name ?? undefined,
    githubOrg.avatar_url
  );

  if (currentUser && org) {
    await upsertOrganizationMember(org.id, currentUser.userId, currentUser.keywayRole);
  }

  return org;
}

/**
 * Get trial eligibility for an organization.
 * Works even if the org doesn't exist in DB yet.
 *
 * @param org - Organization from DB (may be newly created)
 * @returns Trial eligibility info
 */
export function getTrialEligibility(org: Organization): TrialEligibility {
  const trialInfo = getTrialInfo(org);

  // Already on paid plan
  if (org.stripeCustomerId && org.plan === "team") {
    return {
      eligible: false,
      daysAvailable: 0,
      orgLogin: org.login,
      reason: "Organization already has a paid Team plan",
    };
  }

  // Already had a trial
  if (hasHadTrial(org)) {
    if (trialInfo.status === "active") {
      return {
        eligible: false,
        daysAvailable: 0,
        orgLogin: org.login,
        reason: `Trial is already active (${trialInfo.daysRemaining} days remaining)`,
      };
    }
    return {
      eligible: false,
      daysAvailable: 0,
      orgLogin: org.login,
      reason: "Organization has already used their trial",
    };
  }

  // Eligible for trial
  return {
    eligible: true,
    daysAvailable: TRIAL_DURATION_DAYS,
    orgLogin: org.login,
  };
}
