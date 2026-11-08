import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

/**
 * Regression tests for /v1/orgs.
 *
 *  - GET /user/installations also lists installations covering repos where
 *    the caller is only an OUTSIDE COLLABORATOR, so it does not prove org
 *    membership. /connect must require an ACTIVE GitHub org membership (read
 *    with the installation token) before inserting a member row or returning
 *    org details; GET /:org and GET /:org/members drop rows GitHub no longer
 *    backs.
 *  - Mutating org routes refuse API-key authentication (no API key scope
 *    covers org settings, member sync, trials or billing).
 *  - Hardening: org checkout/portal redirect URLs must be on allowed origins.
 *  - An org whose trial expired after an abandoned checkout (Stripe
 *    customer created, never paid) is not "already subscribed".
 *  - Org identity is bound to GitHub's immutable org id: after acme renames and
 *    uninstalls Keyway, whoever re-registers the old login and installs Keyway
 *    gets nothing of acme's Keyway org.
 *  - One membership policy for member-only data and joining: a POSITIVELY
 *    verified active membership is required. Definite "not a member" (404,
 *    pending) deletes the cached row; an ambiguous answer (403 without the
 *    Members permission, 5xx, network, App not installed) keeps the row but
 *    refuses with an actionable error.
 */

const mocks = vi.hoisted(() => ({
  listUserOrganizations: vi.fn(),
  getOrgMembership: vi.fn(),
  listOrgMembers: vi.fn(),
  getInstallationToken: vi.fn(),
  findOrgInstallationViaGitHubAPI: vi.fn(),
  syncInstallationFromAPI: vi.fn(),
  ensureOrganizationExists: vi.fn(),
  getOrganizationByLogin: vi.fn(),
  getOrganizationMembership: vi.fn(),
  getOrganizationDetails: vi.fn(),
  getOrganizationMembersWithGitHub: vi.fn(),
  upsertOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
  updateOrganization: vi.fn(),
  syncOrganizationMembers: vi.fn(),
  startTrial: vi.fn(),
  getTrialInfo: vi.fn(),
  isStripeEnabled: vi.fn(),
  createOrgCheckoutSession: vi.fn(),
  createOrgPortalSession: vi.fn(),
  usersFindFirst: vi.fn(),
  vcsAppInstallationsFindFirst: vi.fn(),
}));

vi.mock("../../src/config", () => ({
  config: {
    cors: { allowedOrigins: ["https://app.keyway.sh"] },
    github: { apiBaseUrl: "https://api.github.com" },
  },
}));

vi.mock("../../src/middleware/auth", async () => ({
  // The real shared API-key refusal; only authentication is stubbed.
  rejectApiKeyAuth: (
    await vi.importActual<typeof import("../../src/middleware/auth")>("../../src/middleware/auth")
  ).rejectApiKeyAuth,
  authenticateGitHub: async (request: any) => {
    request.vcsUser = {
      forgeType: "github",
      forgeUserId: "gh-mallory",
      username: "mallory",
      email: "mallory@example.com",
      avatarUrl: null,
    };
    request.githubUser = request.vcsUser;
    request.accessToken = "gho_user_token";
    // Simulate the API-key branch of the real middleware.
    if (request.headers["x-test-api-key"]) {
      request.apiKey = {
        id: "key-1",
        name: "ci",
        environment: "live",
        scopes: ["read:secrets", "write:secrets", "delete:secrets", "admin:api-keys"],
        userId: "u-mallory",
      };
    }
  },
  requireApiKeyScope:
    (...scopes: string[]) =>
    async (request: any) => {
      if (request.apiKey && !scopes.every((s) => request.apiKey.scopes.includes(s))) {
        throw new Error("missing scope");
      }
    },
}));

vi.mock("../../src/db", () => ({
  db: {
    query: {
      users: { findFirst: mocks.usersFindFirst },
      vcsAppInstallations: { findFirst: mocks.vcsAppInstallationsFindFirst },
    },
  },
  users: {},
  vcsAppInstallations: {},
}));

vi.mock("../../src/services/organization.service", () => ({
  getOrganizationsForUser: vi.fn().mockResolvedValue([]),
  getOrganizationByLogin: mocks.getOrganizationByLogin,
  getOrganizationDetails: mocks.getOrganizationDetails,
  getOrganizationMembersWithGitHub: mocks.getOrganizationMembersWithGitHub,
  updateOrganization: mocks.updateOrganization,
  syncOrganizationMembers: mocks.syncOrganizationMembers,
  getOrganizationMembership: mocks.getOrganizationMembership,
  ensureOrganizationExists: mocks.ensureOrganizationExists,
  upsertOrganizationMember: mocks.upsertOrganizationMember,
  removeOrganizationMember: mocks.removeOrganizationMember,
}));

vi.mock("../../src/services/trial.service", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/trial.service")>(
    "../../src/services/trial.service"
  );
  return {
    startTrial: mocks.startTrial,
    getTrialInfo: mocks.getTrialInfo,
    hasPaidOrgSubscription: actual.hasPaidOrgSubscription,
    TRIAL_DURATION_DAYS: 15,
  };
});

vi.mock("../../src/services/activity.service", () => ({
  detectPlatform: vi.fn().mockReturnValue("web"),
}));

vi.mock("../../src/utils/email", () => ({
  sendTrialStartedEmail: vi.fn(),
}));

vi.mock("../../src/utils/github", () => ({
  listOrgMembers: mocks.listOrgMembers,
  listUserOrganizations: mocks.listUserOrganizations,
  getOrgMembership: mocks.getOrgMembership,
}));

vi.mock("../../src/services/github-app.service", () => ({
  getInstallationToken: mocks.getInstallationToken,
  findOrgInstallationViaGitHubAPI: mocks.findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI: mocks.syncInstallationFromAPI,
}));

vi.mock("../../src/services/billing.service", () => ({
  isStripeEnabled: mocks.isStripeEnabled,
  createOrgCheckoutSession: mocks.createOrgCheckoutSession,
  createOrgPortalSession: mocks.createOrgPortalSession,
  getAvailablePrices: vi.fn().mockResolvedValue(null),
}));

import { organizationsRoutes } from "../../src/api/v1/routes/organizations.routes";

const mallory = {
  id: "u-mallory",
  forgeType: "github",
  forgeUserId: "gh-mallory",
  username: "mallory",
  email: "mallory@example.com",
  plan: "free",
};

/** GitHub org 98765, currently named acme-corp. */
const acme = {
  id: "org-acme",
  forgeType: "github",
  forgeOrgId: "98765",
  login: "acme-corp",
  plan: "free",
  stripeCustomerId: null,
  trialStartedAt: null,
  trialEndsAt: null,
  trialConvertedAt: null,
};

const acmeDetails = {
  id: "org-acme",
  login: "acme-corp",
  // What a member row unlocks: other members' private emails, Stripe customer id
  members: [{ username: "alice", email: "alice-private@acme.example" }],
  stripeCustomerId: "cus_acme",
  defaultPermissions: {},
};

/** The Keyway App installation on GitHub org 98765. */
const acmeInstallation = {
  installationId: 42,
  accountId: 98765,
  accountLogin: "acme-corp",
  accountType: "organization",
  status: "active",
};

/**
 * acme-corp renamed itself and uninstalled Keyway; Mallory re-registered the
 * name "acme-corp" (GitHub org 4242), installed Keyway on it and is its admin.
 */
function malloryReclaimsTheLogin() {
  mocks.vcsAppInstallationsFindFirst.mockResolvedValue(undefined); // nothing active for 98765
  mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue({
    ...acmeInstallation,
    installationId: 666,
    accountId: 4242,
  });
  mocks.getInstallationToken.mockResolvedValue("mallory-install-token");
  mocks.getOrgMembership.mockResolvedValue({
    role: "admin",
    state: "active",
    organization: { id: 4242, login: "acme-corp", avatar_url: "" },
  });
}

/** Fetch stub for the definitive membership read (GET /orgs/:org/memberships/:user). */
function stubGitHubMembershipStatus(status: number) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(status === 404 ? JSON.stringify({ message: "Not Found" }) : "{}", { status })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.usersFindFirst.mockResolvedValue(mallory);
  mocks.vcsAppInstallationsFindFirst.mockResolvedValue(acmeInstallation);
  mocks.getInstallationToken.mockResolvedValue("install-token");
  // Behind a null membership read, GitHub's answer is a definitive 404 unless a
  // test says otherwise.
  stubGitHubMembershipStatus(404);
  mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);
  // The App is installed on acme-corp and covers a repo Mallory collaborates on,
  // so /user/installations lists acme-corp (role defaults to "member").
  mocks.listUserOrganizations.mockResolvedValue([
    { id: 98765, login: "acme-corp", role: "member", avatar_url: "", description: null },
  ]);
  mocks.getOrganizationDetails.mockResolvedValue(acmeDetails);
  mocks.getOrganizationMembersWithGitHub.mockResolvedValue([]);
  mocks.ensureOrganizationExists.mockResolvedValue(acme);
  mocks.upsertOrganizationMember.mockResolvedValue({});
  mocks.removeOrganizationMember.mockResolvedValue(undefined);
  mocks.listOrgMembers.mockResolvedValue([]);
  mocks.isStripeEnabled.mockReturnValue(true);
  mocks.createOrgCheckoutSession.mockResolvedValue("https://checkout.stripe.com/c/1");
  mocks.createOrgPortalSession.mockResolvedValue("https://billing.stripe.com/p/1");
  mocks.getTrialInfo.mockReturnValue({
    status: "none",
    startedAt: null,
    endsAt: null,
    convertedAt: null,
    daysRemaining: null,
  });

  app = Fastify({ logger: false });
  await app.register(organizationsRoutes, { prefix: "/v1/orgs" });
  await app.ready();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

// ============================================================================
// POST /v1/orgs/connect
// ============================================================================

describe("POST /v1/orgs/connect requires an active GitHub org membership", () => {
  it("refuses an outside collaborator (GitHub reports no membership) on an existing org", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue(null);
    mocks.getOrgMembership.mockResolvedValue(null); // 404: not an org member

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
    expect(res.body).not.toContain("alice-private@acme.example");
  });

  it("refuses an outside collaborator on a not-yet-connected org (no member row created)", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(null);
    mocks.getOrgMembership.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.ensureOrganizationExists).not.toHaveBeenCalled();
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("refuses a pending (invited, not accepted) membership", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue(null);
    mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "pending" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("fails closed with a retryable 503 when the membership read errors (no fallback to the user-token role)", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue(null);
    mocks.getOrgMembership.mockRejectedValue(new Error("GitHub down"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("retry");
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("does not return org details to a stale member row GitHub no longer backs (and drops it)", async () => {
    // Row created by the pre-fix bug; Mallory never was an org member.
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue({ id: "m-1", orgId: "org-acme", orgRole: "member" });
    mocks.getOrgMembership.mockResolvedValue(null); // + 404 on the status read

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("alice-private@acme.example");
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id);
  });

  it("refuses an already-connected member GitHub can't confirm (App lacks Members: read), keeping the row", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue({ id: "m-1", orgId: "org-acme", orgRole: "member" });
    mocks.getOrgMembership.mockResolvedValue(null);
    stubGitHubMembershipStatus(403);

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Members");
    expect(res.body).not.toContain("alice-private@acme.example");
    expect(mocks.getOrganizationDetails).not.toHaveBeenCalled();
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("returns an already-connected, live-confirmed member's org without re-adding them", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue({ id: "m-1", orgId: "org-acme", orgRole: "member" });
    mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.message).toBe("Organization already connected");
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("refuses to join an existing org through a reclaimed login (installation of another GitHub org)", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue(null);
    malloryReclaimsTheLogin();

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
    expect(mocks.getInstallationToken).not.toHaveBeenCalled();
    expect(res.body).not.toContain("alice-private@acme.example");
  });

  it("refuses a new org whose GitHub id differs from the installation's (no member row)", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(null);
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });
    mocks.ensureOrganizationExists.mockResolvedValue({ ...acme, forgeOrgId: "4242" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(409);
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("adds an active GitHub member with the installation-token role", async () => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue(null);
    mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/connect",
      payload: { orgLogin: "acme-corp" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getOrgMembership).toHaveBeenCalledWith("install-token", "acme-corp", "mallory");
    expect(mocks.upsertOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id, "member");
  });
});

// ============================================================================
// GET /v1/orgs/:org and GET /v1/orgs/:org/members drop unbacked rows
// ============================================================================

describe("member-gated reads re-check the live GitHub membership", () => {
  beforeEach(() => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue({ id: "m-1", orgId: "org-acme", orgRole: "member" });
  });

  it("GET /:org removes the row and returns 403 when GitHub answers 404 for the membership", async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    const fetchMock = stubGitHubMembershipStatus(404);

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("alice-private@acme.example");
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id);
    // The definitive read uses the installation token and encodes the path.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/orgs/acme-corp/memberships/mallory");
    expect(init.headers.Authorization).toBe("Bearer install-token");
  });

  it("GET /:org removes the row when the membership is only pending", async () => {
    mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "pending" });

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(403);
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id);
  });

  it("GET /:org refuses but keeps the row when the App lacks Members: read (GitHub 403)", async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubGitHubMembershipStatus(403);

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Members");
    expect(res.body).toContain("acme-corp");
    expect(res.body).not.toContain("alice-private@acme.example");
    expect(mocks.getOrganizationDetails).not.toHaveBeenCalled();
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("GET /:org answers 503 (retry) and keeps the row when GitHub is down", async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubGitHubMembershipStatus(502);

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("alice-private@acme.example");
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("GET /:org refuses but keeps the row when the Keyway App is not installed on the org", async () => {
    mocks.vcsAppInstallationsFindFirst.mockResolvedValue(undefined);
    mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("not installed");
    expect(mocks.getOrganizationDetails).not.toHaveBeenCalled();
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("GET /:org does not serve acme's data to the admin of a GitHub org that reclaimed the login", async () => {
    malloryReclaimsTheLogin();

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("alice-private@acme.example");
    expect(mocks.getOrganizationDetails).not.toHaveBeenCalled();
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("GET /:org serves an active member and self-heals the role", async () => {
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.role).toBe("owner");
    expect(mocks.upsertOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id, "owner");
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("GET /:org/members refuses (and removes) a row GitHub answers 404 for", async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubGitHubMembershipStatus(404);

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp/members" });

    expect(res.statusCode).toBe(403);
    expect(mocks.getOrganizationMembersWithGitHub).not.toHaveBeenCalled();
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id);
  });

  it("GET /:org/members refuses but keeps the row when the App lacks Members: read", async () => {
    mocks.getOrgMembership.mockResolvedValue(null);
    stubGitHubMembershipStatus(403);

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp/members" });

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Members");
    expect(mocks.getOrganizationMembersWithGitHub).not.toHaveBeenCalled();
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("GET /:org/members answers 503 when GitHub is down", async () => {
    mocks.getOrgMembership.mockRejectedValue(new Error("ECONNRESET"));

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp/members" });

    expect(res.statusCode).toBe(503);
    expect(mocks.getOrganizationMembersWithGitHub).not.toHaveBeenCalled();
  });

  for (const path of ["billing", "trial"]) {
    it(`GET /:org/${path} refuses (and removes) a row GitHub answers 404 for`, async () => {
      mocks.getOrgMembership.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: `/v1/orgs/acme-corp/${path}` });

      expect(res.statusCode).toBe(403);
      expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("org-acme", mallory.id);
    });

    it(`GET /:org/${path} refuses but keeps the row when the App lacks Members: read`, async () => {
      mocks.getOrgMembership.mockResolvedValue(null);
      stubGitHubMembershipStatus(403);

      const res = await app.inject({ method: "GET", url: `/v1/orgs/acme-corp/${path}` });

      expect(res.statusCode).toBe(403);
      expect(res.body).toContain("Members");
      expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
    });

    it(`GET /:org/${path} serves a live-confirmed member`, async () => {
      mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

      const res = await app.inject({ method: "GET", url: `/v1/orgs/acme-corp/${path}` });

      expect(res.statusCode).toBe(200);
    });
  }

  it("GET /:org/members serves an active member", async () => {
    mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

    const res = await app.inject({ method: "GET", url: "/v1/orgs/acme-corp/members" });

    expect(res.statusCode).toBe(200);
    expect(mocks.getOrganizationMembersWithGitHub).toHaveBeenCalled();
  });
});

// ============================================================================
// mutating org routes refuse API-key authentication
// ============================================================================

describe("mutating org routes refuse API keys", () => {
  beforeEach(() => {
    mocks.getOrganizationByLogin.mockResolvedValue(acme);
    mocks.getOrganizationMembership.mockResolvedValue({ id: "m-1", orgId: "org-acme", orgRole: "owner" });
    // Even a live GitHub admin: the key must not act with the user's full identity.
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });
    mocks.updateOrganization.mockResolvedValue({
      id: "org-acme",
      login: "acme-corp",
      displayName: null,
      defaultPermissions: {},
      updatedAt: new Date(),
    });
    mocks.startTrial.mockResolvedValue({
      success: true,
      organization: { ...acme, trialEndsAt: new Date() },
    });
    mocks.syncOrganizationMembers.mockResolvedValue({ added: 0, updated: 0, removed: 0 });
  });

  const routes: Array<{ method: "POST" | "PUT"; url: string; payload?: object }> = [
    { method: "POST", url: "/v1/orgs/connect", payload: { orgLogin: "acme-corp" } },
    { method: "PUT", url: "/v1/orgs/acme-corp", payload: { defaultPermissions: {} } },
    { method: "POST", url: "/v1/orgs/acme-corp/members/sync" },
    { method: "POST", url: "/v1/orgs/acme-corp/trial/start" },
    {
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/checkout",
      payload: {
        priceId: "price_business_monthly",
        successUrl: "https://app.keyway.sh/ok",
        cancelUrl: "https://app.keyway.sh/cancel",
      },
    },
    {
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/portal",
      payload: { returnUrl: "https://app.keyway.sh/billing" },
    },
  ];

  for (const route of routes) {
    it(`${route.method} ${route.url} → 403 with an API key`, async () => {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { "x-test-api-key": "1" },
        payload: route.payload,
      });

      expect(res.statusCode).toBe(403);
      expect(res.body).toContain(
        "API keys cannot manage organizations. Sign in to Keyway with GitHub to do this."
      );
      expect(mocks.updateOrganization).not.toHaveBeenCalled();
      expect(mocks.syncOrganizationMembers).not.toHaveBeenCalled();
      expect(mocks.startTrial).not.toHaveBeenCalled();
      expect(mocks.createOrgCheckoutSession).not.toHaveBeenCalled();
      expect(mocks.createOrgPortalSession).not.toHaveBeenCalled();
      expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
    });
  }

  it("PUT /:org refuses the admin of a GitHub org that reclaimed the login", async () => {
    malloryReclaimsTheLogin();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/orgs/acme-corp",
      payload: { defaultPermissions: { read: { protected: { read: true, write: true } } } },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("PUT /:org still works for a live admin on a session (non-API-key) login", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/orgs/acme-corp",
      payload: { displayName: "Acme" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.updateOrganization).toHaveBeenCalled();
  });
});

// ============================================================================
// Hardening — org billing redirect URLs restricted to allowed origins
// ============================================================================

describe("Org billing redirect URLs must be on allowed origins", () => {
  beforeEach(() => {
    mocks.getOrganizationByLogin.mockResolvedValue({ ...acme, stripeCustomerId: "cus_acme" });
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });
  });

  it("rejects a checkout successUrl on a foreign origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/checkout",
      payload: {
        priceId: "price_business_monthly",
        successUrl: "https://evil.example/phish",
        cancelUrl: "https://app.keyway.sh/cancel",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.createOrgCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects a checkout cancelUrl on a foreign origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/checkout",
      payload: {
        priceId: "price_business_monthly",
        successUrl: "https://app.keyway.sh/ok",
        cancelUrl: "https://evil.example/phish",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.createOrgCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects a portal returnUrl on a foreign origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/portal",
      payload: { returnUrl: "https://evil.example/phish" },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.createOrgPortalSession).not.toHaveBeenCalled();
  });

  it("accepts allowed-origin URLs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/portal",
      payload: { returnUrl: "https://app.keyway.sh/billing" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.createOrgPortalSession).toHaveBeenCalledWith("org-acme", "https://app.keyway.sh/billing");
  });
});

// ============================================================================
// an abandoned checkout must not count as a subscription
// ============================================================================

describe("checkout after an expired trial with an abandoned checkout", () => {
  beforeEach(() => {
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });
  });

  it("lets the org subscribe (the Stripe customer exists but nothing was paid)", async () => {
    // startTrial set plan=business; the abandoned checkout stored a customer id.
    mocks.getOrganizationByLogin.mockResolvedValue({
      ...acme,
      plan: "business",
      stripeCustomerId: "cus_abandoned",
      trialStartedAt: new Date(Date.now() - 20 * 86400000),
      trialEndsAt: new Date(Date.now() - 5 * 86400000),
      trialConvertedAt: null,
    });
    mocks.getTrialInfo.mockReturnValue({
      status: "expired",
      startedAt: new Date(Date.now() - 20 * 86400000),
      endsAt: new Date(Date.now() - 5 * 86400000),
      convertedAt: null,
      daysRemaining: null,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/checkout",
      payload: {
        priceId: "price_business_monthly",
        successUrl: "https://app.keyway.sh/ok",
        cancelUrl: "https://app.keyway.sh/cancel",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.createOrgCheckoutSession).toHaveBeenCalled();
  });

  it("still refuses a second checkout for a genuinely subscribed org", async () => {
    // Plan written by the subscription webhook, no trial involved.
    mocks.getOrganizationByLogin.mockResolvedValue({
      ...acme,
      plan: "team",
      stripeCustomerId: "cus_paid",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs/acme-corp/billing/checkout",
      payload: {
        priceId: "price_business_monthly",
        successUrl: "https://app.keyway.sh/ok",
        cancelUrl: "https://app.keyway.sh/cancel",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.createOrgCheckoutSession).not.toHaveBeenCalled();
  });
});
