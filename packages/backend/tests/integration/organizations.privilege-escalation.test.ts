import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

/**
 * Privilege-escalation regression tests.
 *
 * Pre-fix, three vectors allowed a non-admin GitHub user to become a
 * Keyway org "owner":
 *  1. POST /v1/orgs/connect (create-org branch) — auto-promoted regardless
 *     of the caller's GitHub role.
 *  2. POST /v1/vaults — same auto-promotion when bootstrapping a new org.
 *  3. PUT /v1/orgs/:org — accepted any DB-local owner row, even if the
 *     user was not (or no longer) a GitHub org admin.
 *
 * These tests pin the route-level behavior:
 *  - /connect respects targetOrg.role from listUserOrganizations
 *  - /vaults consults getOrgMembershipForCurrentUser before inserting
 *  - PUT /:org refuses anyone who is not a live GitHub admin
 */

// ----- hoisted shared mock state ----------------------------------------

const mocks = vi.hoisted(() => ({
  // capture the last call to ensureOrganizationExists so each test can
  // assert on the role the route forwarded to the service
  ensureOrganizationExists: vi.fn(),
  listUserOrganizations: vi.fn(),
  getOrgMembershipForCurrentUser: vi.fn(),
  getOrgMembership: vi.fn(),
  getInstallationToken: vi.fn(),
  getOrganizationByLogin: vi.fn(),
  getOrganizationMembership: vi.fn(),
  upsertOrganizationMember: vi.fn(),
  isOrganizationOwner: vi.fn(),
  updateOrganization: vi.fn(),
  getOrganizationDetails: vi.fn(),
  getRepoInfoWithApp: vi.fn(),
  getTokenForRepo: vi.fn(),
  findOrgInstallationViaGitHubAPI: vi.fn(),
  syncInstallationFromAPI: vi.fn(),
  getOrThrowUser: vi.fn(),
  getEffectivePlanWithTrial: vi.fn(),
  getTrialEligibility: vi.fn(),
  checkVaultCreationAllowed: vi.fn(),
  vaultsFindFirst: vi.fn(),
  vaultEnvironmentsFindMany: vi.fn(),
  usersFindFirst: vi.fn(),
  vcsAppInstallationsFindFirst: vi.fn(),
  installations: [] as any[],
}));

// ----- module mocks (must precede route imports) ------------------------

vi.mock("../../src/middleware/auth", () => ({
  authenticateGitHub: async (request: any) => {
    // Stub auth: tests set request.vcsUser via headers
    request.vcsUser = {
      forgeType: "github",
      forgeUserId: "u-bob-gh-id",
      username: "bob",
      email: "bob@example.com",
      avatarUrl: null,
    };
    request.githubUser = request.vcsUser;
    request.accessToken = "gho_test_token";
  },
  requireAdminAccess: async () => {
    // Stubbed — tests configure repo-admin elsewhere
  },
  requireApiKeyScope: () => async () => {},
  requireAdminOrOwnerAccess: async () => {},
  requireEnvironmentAccess: () => async () => {},
}));

vi.mock("../../src/db", () => ({
  db: {
    query: {
      users: { findFirst: mocks.usersFindFirst },
      vaults: { findFirst: mocks.vaultsFindFirst },
      vcsAppInstallations: { findFirst: mocks.vcsAppInstallationsFindFirst },
      vaultEnvironments: { findMany: mocks.vaultEnvironmentsFindMany },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "vault-new" }]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  users: {},
  vaults: {},
  vcsAppInstallations: {
    accountLogin: "accountLogin",
    accountType: "accountType",
    status: "status",
  },
  organizations: {},
  organizationMembers: {},
  vaultEnvironments: { vaultId: "vaultId" },
  secrets: {},
  environmentPermissions: {},
  permissionOverrides: {},
  apiKeys: {},
}));

vi.mock("../../src/services/organization.service", () => ({
  ensureOrganizationExists: mocks.ensureOrganizationExists,
  getOrganizationByLogin: mocks.getOrganizationByLogin,
  getOrganizationMembership: mocks.getOrganizationMembership,
  upsertOrganizationMember: mocks.upsertOrganizationMember,
  isOrganizationOwner: mocks.isOrganizationOwner,
  updateOrganization: mocks.updateOrganization,
  getOrganizationDetails: mocks.getOrganizationDetails,
  getOrganizationsForUser: vi.fn().mockResolvedValue([]),
  getOrganizationMembers: vi.fn().mockResolvedValue([]),
  syncOrganizationMembers: vi.fn().mockResolvedValue({ added: 0, updated: 0, removed: 0 }),
  getTrialEligibility: mocks.getTrialEligibility,
}));

vi.mock("../../src/services/trial.service", () => ({
  startTrial: vi.fn(),
  getTrialInfo: vi.fn().mockReturnValue({ status: "none" }),
  TRIAL_DURATION_DAYS: 15,
  getEffectivePlanWithTrial: mocks.getEffectivePlanWithTrial,
}));

vi.mock("../../src/services/github-app.service", () => ({
  getInstallationToken: mocks.getInstallationToken,
  findOrgInstallationViaGitHubAPI: mocks.findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI: mocks.syncInstallationFromAPI,
}));

vi.mock("../../src/utils/github", () => ({
  listUserOrganizations: mocks.listUserOrganizations,
  getOrgMembershipForCurrentUser: mocks.getOrgMembershipForCurrentUser,
  getOrgMembership: mocks.getOrgMembership,
  listOrgMembers: vi.fn().mockResolvedValue([]),
  listOrgMembersWithApp: vi.fn().mockResolvedValue([]),
  getRepoInfoWithApp: mocks.getRepoInfoWithApp,
  getRepoCollaboratorsWithApp: vi.fn().mockResolvedValue([]),
  getUserRoleWithApp: vi.fn().mockResolvedValue("admin"),
  getTokenForRepo: mocks.getTokenForRepo,
}));

vi.mock("../../src/utils/email", () => ({
  sendTrialStartedEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendSecurityAlertEmail: vi.fn(),
}));

vi.mock("../../src/utils/analytics", () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: { VAULT_CREATED: "v" },
}));

vi.mock("../../src/services/billing.service", () => ({
  isStripeEnabled: vi.fn().mockReturnValue(false),
  createOrgCheckoutSession: vi.fn(),
  createOrgPortalSession: vi.fn(),
  getAvailablePrices: vi.fn(),
}));

vi.mock("../../src/services/usage.service", () => ({
  canWriteToVault: vi.fn().mockResolvedValue(true),
  computeUserUsage: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/services", async () => {
  const actual = await vi.importActual<any>("../../src/services");
  return {
    ...actual,
    checkVaultCreationAllowed: mocks.checkVaultCreationAllowed,
    getVaultByRepo: vi.fn().mockResolvedValue(null),
    getVaultByRepoInternal: vi.fn().mockResolvedValue(null),
    logActivity: vi.fn(),
    extractRequestInfo: vi.fn().mockReturnValue({ ip: null, userAgent: null }),
    detectPlatform: vi.fn().mockReturnValue("api"),
  };
});

vi.mock("../../src/utils/user-lookup", () => ({
  getOrThrowUser: mocks.getOrThrowUser,
  getUserFromVcsUser: vi.fn(),
}));

// ----- imports (after mocks) --------------------------------------------

import { organizationsRoutes } from "../../src/api/v1/routes/organizations.routes";
import { vaultsRoutes } from "../../src/api/v1/routes/vaults.routes";

// ----- helpers ----------------------------------------------------------

const bobUser = {
  id: "u-bob-keyway-id",
  forgeType: "github",
  forgeUserId: "u-bob-gh-id",
  username: "bob",
  email: "bob@example.com",
  avatarUrl: null,
  plan: "pro",
};

function resetAll() {
  vi.clearAllMocks();
  mocks.usersFindFirst.mockResolvedValue(bobUser);
  mocks.ensureOrganizationExists.mockResolvedValue({
    id: "org-acme",
    login: "acme-corp",
    forgeType: "github",
    forgeOrgId: "98765",
    plan: "free",
    trialStartedAt: null,
    trialEndsAt: null,
    trialConvertedAt: null,
  });
  mocks.getEffectivePlanWithTrial.mockReturnValue("pro");
  mocks.getTrialEligibility.mockReturnValue({ canStart: false });
  mocks.checkVaultCreationAllowed.mockResolvedValue({ allowed: true });
  mocks.getOrganizationDetails.mockResolvedValue({ id: "org-acme", login: "acme-corp" });
  mocks.getInstallationToken.mockResolvedValue("install-token");
  mocks.getTokenForRepo.mockResolvedValue("install-token");
  mocks.vaultsFindFirst.mockResolvedValue(null);
  mocks.vaultEnvironmentsFindMany.mockResolvedValue([]);
  mocks.vcsAppInstallationsFindFirst.mockResolvedValue({
    installationId: "install-1",
    accountLogin: "acme-corp",
    accountType: "organization",
    status: "active",
  });
  mocks.getOrThrowUser.mockResolvedValue(bobUser);
  mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);
}

// ============================================================================
// POST /v1/orgs/connect
// ============================================================================

describe("POST /v1/orgs/connect — privilege escalation regression", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetAll();
    app = Fastify({ logger: false });
    await app.register(organizationsRoutes, { prefix: "/v1/orgs" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("forwards keywayRole='member' to ensureOrganizationExists when caller is GitHub member", async () => {
    // Caller is a non-admin member of acme-corp on GitHub
    mocks.listUserOrganizations.mockResolvedValue([
      { id: 98765, login: "acme-corp", role: "member", avatar_url: null, description: null },
    ]);
    // Org not yet in DB → triggers create-org branch
    mocks.getOrganizationByLogin.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.ensureOrganizationExists).toHaveBeenCalledTimes(1);
    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    expect(currentUser).toEqual({ userId: bobUser.id, keywayRole: "member" });
    expect(currentUser.keywayRole).not.toBe("owner"); // the bug
  });

  it("forwards keywayRole='owner' to ensureOrganizationExists when caller is GitHub admin", async () => {
    mocks.listUserOrganizations.mockResolvedValue([
      { id: 98765, login: "acme-corp", role: "admin", avatar_url: null, description: null },
    ]);
    mocks.getOrganizationByLogin.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(response.statusCode).toBe(200);
    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    expect(currentUser).toEqual({ userId: bobUser.id, keywayRole: "owner" });
  });

  it("prefers the authoritative installation-token role over the user-token role", async () => {
    // User-token view (listUserOrganizations) says "member"...
    mocks.listUserOrganizations.mockResolvedValue([
      { id: 98765, login: "acme-corp", role: "member", avatar_url: null, description: null },
    ]);
    // ...but the authoritative installation-token read says the caller is an admin.
    mocks.getOrgMembership.mockResolvedValue({
      role: "admin",
      state: "active",
      organization: { id: 98765, login: "acme-corp", avatar_url: "" },
    });
    mocks.getOrganizationByLogin.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getOrgMembership).toHaveBeenCalledWith("install-token", "acme-corp", bobUser.username);
    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    // Authoritative read wins → owner, not the user-token "member".
    expect(currentUser.keywayRole).toBe("owner");
  });
});

// ============================================================================
// POST /v1/vaults — re-resolves caller's GitHub org membership
// ============================================================================

describe("POST /v1/vaults — privilege escalation regression", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetAll();
    mocks.getRepoInfoWithApp.mockResolvedValue({
      repoId: "999",
      isPrivate: false,
      isOrganization: true,
    });
    app = Fastify({ logger: false });
    await app.register(vaultsRoutes, { prefix: "/v1/vaults" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("does NOT register caller as Keyway member when they're not a GitHub org member (outside collaborator)", async () => {
    // Caller has admin on the repo (passed requireAdminAccess) but is NOT
    // a member of the org. /user/memberships/orgs/:org returns 404.
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/vaults",
      payload: { repoFullName: "acme-corp/private-repo" },
    });

    // ensureOrganizationExists was called with no currentUser → no membership inserted
    expect(mocks.ensureOrganizationExists).toHaveBeenCalled();
    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    expect(currentUser).toBeUndefined();
    expect(response.statusCode).toBeLessThan(500); // route logic completed
  });

  it("forwards keywayRole='member' when caller is a GitHub member (not admin) of the org", async () => {
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue({
      role: "member",
      state: "active",
    });

    await app.inject({
      method: "POST",
      url: "/v1/vaults",
      payload: { repoFullName: "acme-corp/some-repo" },
    });

    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    expect(currentUser).toEqual({ userId: bobUser.id, keywayRole: "member" });
  });

  it("forwards keywayRole='owner' when caller is a GitHub admin of the org", async () => {
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue({
      role: "admin",
      state: "active",
    });

    await app.inject({
      method: "POST",
      url: "/v1/vaults",
      payload: { repoFullName: "acme-corp/some-repo" },
    });

    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    expect(currentUser).toEqual({ userId: bobUser.id, keywayRole: "owner" });
  });

  it("does NOT register caller when membership state is pending", async () => {
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue({
      role: "admin",
      state: "pending",
    });

    await app.inject({
      method: "POST",
      url: "/v1/vaults",
      payload: { repoFullName: "acme-corp/some-repo" },
    });

    const [, , currentUser] = mocks.ensureOrganizationExists.mock.calls[0];
    expect(currentUser).toBeUndefined();
  });
});

// ============================================================================
// PUT /v1/orgs/:org — refuses non-admin even if DB owner row exists
// ============================================================================

describe("PUT /v1/orgs/:org — fail-closed authorization", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetAll();
    mocks.getOrganizationByLogin.mockResolvedValue({
      id: "org-acme",
      login: "acme-corp",
    });
    mocks.updateOrganization.mockResolvedValue({
      id: "org-acme",
      login: "acme-corp",
      displayName: "Acme",
      defaultPermissions: {},
      updatedAt: new Date(),
    });
    app = Fastify({ logger: false });
    await app.register(organizationsRoutes, { prefix: "/v1/orgs" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects a DB-local owner who is not a current GitHub admin (the defense-in-depth)", async () => {
    // Bob is owner in our DB (hypothetical pre-fix promotion) ...
    mocks.isOrganizationOwner.mockResolvedValue(true);
    // ... but GitHub says he's only a member now.
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue({
      role: "member",
      state: "active",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/orgs/acme-corp",
      payload: { defaultPermissions: { read: { protected: { read: true, write: true } } } },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
  });

  it("rejects a DB-local owner whose GitHub membership has lapsed (404 on /user/memberships)", async () => {
    mocks.isOrganizationOwner.mockResolvedValue(true);
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue(null);

    const response = await app.inject({
      method: "PUT",
      url: "/v1/orgs/acme-corp",
      payload: { displayName: "Hijacked" },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
  });

  it("rejects when GitHub membership is pending (not yet active)", async () => {
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue({
      role: "admin",
      state: "pending",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/orgs/acme-corp",
      payload: { displayName: "Acme" },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
  });

  it("accepts a current GitHub admin (the legitimate path)", async () => {
    mocks.getOrgMembershipForCurrentUser.mockResolvedValue({
      role: "admin",
      state: "active",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/orgs/acme-corp",
      payload: { displayName: "Acme Inc" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateOrganization).toHaveBeenCalledTimes(1);
  });
});
