import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { ApiError } from "../../src/lib/errors";

/**
 * Security regressions for the exposure routes:
 *
 *  - Access-history must be scoped to the URL's vault.
 *  - The org-owner gate must be a LIVE GitHub admin check, not the cached
 *        organization_members.org_role (no webhook on demotion).
 *  - API keys need read:secrets.
 */

const mocks = vi.hoisted(() => ({
  usersFindFirst: vi.fn(),
  vaultsFindFirst: vi.fn(),
  installationFindFirst: vi.fn(),
  getOrgMembership: vi.fn(),
  getInstallationToken: vi.fn(),
  findOrgInstallationViaGitHubAPI: vi.fn(),
  getOrganizationByLogin: vi.fn(),
  getOrganizationById: vi.fn(),
  isOrganizationOwner: vi.fn(),
  getExposureForOrg: vi.fn(),
  getExposureForUser: vi.fn(),
  getSecretAccessHistory: vi.fn(),
}));

vi.mock("../../src/db", async () => {
  const schema = await vi.importActual<typeof import("../../src/db/schema")>("../../src/db/schema");
  return {
    ...schema,
    db: {
      query: {
        users: { findFirst: mocks.usersFindFirst },
        vaults: { findFirst: mocks.vaultsFindFirst },
        vcsAppInstallations: { findFirst: mocks.installationFindFirst },
      },
    },
  };
});

vi.mock("../../src/middleware/auth", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth")>(
    "../../src/middleware/auth"
  );
  return {
    ...actual,
    authenticateGitHub: async (request: any) => {
      request.vcsUser = {
        forgeType: "github",
        forgeUserId: "gh-alice",
        username: "alice",
        email: null,
        avatarUrl: null,
      };
      request.githubUser = request.vcsUser;
      const scopes = request.headers["x-test-api-key-scopes"];
      if (typeof scopes === "string") {
        request.apiKey = {
          id: "key-1",
          name: "ci",
          environment: "live",
          scopes: scopes ? scopes.split(",") : [],
          userId: "u-alice",
        };
      }
    },
  };
});

vi.mock("../../src/utils/github", () => ({
  getOrgMembership: mocks.getOrgMembership,
  getUserRoleWithApp: vi.fn().mockResolvedValue("read"),
}));

vi.mock("../../src/services/github-app.service", () => ({
  getInstallationToken: mocks.getInstallationToken,
  findOrgInstallationViaGitHubAPI: mocks.findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI: vi.fn(),
}));

vi.mock("../../src/services/organization.service", () => ({
  getOrganizationByLogin: mocks.getOrganizationByLogin,
  getOrganizationById: mocks.getOrganizationById,
  isOrganizationOwner: mocks.isOrganizationOwner,
}));

vi.mock("../../src/services/exposure.service", () => ({
  getExposureForOrg: mocks.getExposureForOrg,
  getExposureForUser: mocks.getExposureForUser,
  getSecretAccessHistory: mocks.getSecretAccessHistory,
}));

vi.mock("../../src/services/trial.service", () => ({
  getEffectivePlanWithTrial: vi.fn().mockReturnValue("business"),
  getEffectivePlanForUser: vi.fn().mockResolvedValue("business"),
}));

import { exposureRoutes } from "../../src/api/v1/routes/exposure.routes";

const alice = { id: "u-alice", forgeType: "github", forgeUserId: "gh-alice", username: "alice" };
// forgeOrgId: GitHub's immutable org id, what the installation must be bound to.
const org = { id: "org-acme", login: "acme", forgeOrgId: "111", plan: "business" };
const orgVault = { id: "vault-a", orgId: "org-acme", repoFullName: "acme/api", ownerId: "u-someone-else" };
const personalVault = { id: "vault-p", orgId: null, repoFullName: "alice/app", ownerId: "u-alice" };

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.usersFindFirst.mockResolvedValue(alice);
  mocks.vaultsFindFirst.mockResolvedValue(personalVault);
  mocks.installationFindFirst.mockResolvedValue({ installationId: 1, accountId: 111, accountLogin: "acme" });
  mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);
  mocks.getInstallationToken.mockResolvedValue("install-token");
  // Status read behind a null membership: GitHub's definitive 404 by default.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  mocks.getOrganizationByLogin.mockResolvedValue(org);
  mocks.getOrganizationById.mockResolvedValue(org);
  mocks.isOrganizationOwner.mockResolvedValue(false);
  mocks.getOrgMembership.mockResolvedValue(null);
  mocks.getExposureForOrg.mockResolvedValue({ summary: { users: 0, secrets: 0, accesses: 0 }, users: [] });
  mocks.getExposureForUser.mockResolvedValue({ user: { id: null, username: "bob", avatarUrl: null }, summary: {}, vaults: [] });
  mocks.getSecretAccessHistory.mockResolvedValue({ accesses: [], total: 0 });

  app = Fastify({ logger: false });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send(error.toProblemDetails(request.id));
    }
    return reply.status((error as { statusCode?: number }).statusCode || 500).send({ detail: error.message });
  });
  await app.register(exposureRoutes, { prefix: "/v1" });
  await app.ready();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

// ============================================================================
// access-history scoping
// ============================================================================

describe("access-history is scoped to the URL's vault", () => {
  it("passes the vault id to getSecretAccessHistory", async () => {
    const { getUserRoleWithApp } = await import("../../src/utils/github");
    (getUserRoleWithApp as any).mockResolvedValueOnce("admin");
    const res = await app.inject({
      method: "GET",
      url: "/v1/vaults/alice/app/secrets/secret-of-another-vault/access-history?limit=10&offset=5",
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getSecretAccessHistory).toHaveBeenCalledWith("secret-of-another-vault", "vault-p", {
      limit: 10,
      offset: 5,
    });
  });
});

describe("access-history on a personal vault requires live repo admin", () => {
  it("refuses the vault creator once they are no longer admin of the repo", async () => {
    const { getUserRoleWithApp } = await import("../../src/utils/github");
    (getUserRoleWithApp as any).mockResolvedValueOnce("read");

    const res = await app.inject({ method: "GET", url: "/v1/vaults/alice/app/secrets/s1/access-history" });

    expect(res.statusCode).toBe(403);
    expect(mocks.getSecretAccessHistory).not.toHaveBeenCalled();
  });

  it("allows a current repo admin, bound to the vault's repo id", async () => {
    const { getUserRoleWithApp } = await import("../../src/utils/github");
    (getUserRoleWithApp as any).mockResolvedValueOnce("admin");
    mocks.vaultsFindFirst.mockResolvedValue({ ...personalVault, ownerId: "u-someone-else", forgeRepoId: "55" });

    const res = await app.inject({ method: "GET", url: "/v1/vaults/alice/app/secrets/s1/access-history" });

    expect(res.statusCode).toBe(200);
    expect(getUserRoleWithApp).toHaveBeenCalledWith("alice/app", "alice", { expectedRepoId: "55" });
  });
});

// ============================================================================
// stale cached org owner
// ============================================================================

describe("org-owner gate uses a live GitHub admin check", () => {
  const orgRoutes = [
    { name: "GET /orgs/:org/exposure", url: "/v1/orgs/acme/exposure", service: mocks.getExposureForOrg },
    { name: "GET /orgs/:org/exposure/:username", url: "/v1/orgs/acme/exposure/bob", service: mocks.getExposureForUser },
  ];

  for (const r of orgRoutes) {
    it(`${r.name}: a demoted admin (cached owner, live member) is refused`, async () => {
      mocks.isOrganizationOwner.mockResolvedValue(true);
      mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

      const res = await app.inject({ method: "GET", url: r.url });

      expect(res.statusCode).toBe(403);
      expect(r.service).not.toHaveBeenCalled();
    });

    it(`${r.name}: refused when GitHub can't confirm the membership`, async () => {
      mocks.isOrganizationOwner.mockResolvedValue(true);
      mocks.getOrgMembership.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: r.url });

      expect(res.statusCode).toBe(403);
      expect(r.service).not.toHaveBeenCalled();
    });

    it(`${r.name}: a current GitHub admin is allowed`, async () => {
      mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });

      const res = await app.inject({ method: "GET", url: r.url });

      expect(res.statusCode).toBe(200);
      expect(mocks.getOrgMembership).toHaveBeenCalledWith("install-token", "acme", "alice");
    });
  }

  /** acme renamed + uninstalled Keyway; mallory re-registered "acme" (GitHub org 999). */
  function reclaimedLogin() {
    mocks.installationFindFirst.mockResolvedValue(undefined);
    mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue({
      installationId: 666,
      accountId: 999,
      accountLogin: "acme",
    });
    mocks.getOrgMembership.mockResolvedValue({
      role: "admin",
      state: "active",
      organization: { id: 999, login: "acme", avatar_url: "" },
    });
  }

  for (const r of orgRoutes) {
    it(`${r.name}: the admin of a GitHub org that reclaimed the login is refused`, async () => {
      reclaimedLogin();

      const res = await app.inject({ method: "GET", url: r.url });

      expect(res.statusCode).toBe(403);
      expect(mocks.getInstallationToken).not.toHaveBeenCalled();
      expect(r.service).not.toHaveBeenCalled();
    });
  }

  it("access-history on an org vault: the admin of a reclaimed login is refused", async () => {
    mocks.vaultsFindFirst.mockResolvedValue(orgVault);
    reclaimedLogin();

    const res = await app.inject({ method: "GET", url: "/v1/vaults/acme/api/secrets/s1/access-history" });

    expect(res.statusCode).toBe(403);
    expect(mocks.getSecretAccessHistory).not.toHaveBeenCalled();
  });

  it("access-history on an org vault: a demoted admin is refused", async () => {
    mocks.vaultsFindFirst.mockResolvedValue(orgVault);
    mocks.isOrganizationOwner.mockResolvedValue(true);
    mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

    const res = await app.inject({ method: "GET", url: "/v1/vaults/acme/api/secrets/s1/access-history" });

    expect(res.statusCode).toBe(403);
    expect(mocks.getSecretAccessHistory).not.toHaveBeenCalled();
  });

  it("access-history on an org vault: a current GitHub admin is allowed", async () => {
    mocks.vaultsFindFirst.mockResolvedValue(orgVault);
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });

    const res = await app.inject({ method: "GET", url: "/v1/vaults/acme/api/secrets/s1/access-history" });

    expect(res.statusCode).toBe(200);
    expect(mocks.getSecretAccessHistory).toHaveBeenCalledWith("s1", "vault-a", { limit: 50, offset: 0 });
  });
});

// ============================================================================
// API key scopes
// ============================================================================

describe("exposure routes require read:secrets for API keys", () => {
  const urls = [
    "/v1/orgs/acme/exposure",
    "/v1/orgs/acme/exposure/bob",
    "/v1/vaults/alice/app/secrets/s1/access-history",
  ];

  beforeEach(() => {
    // Authorized by every role check, so only the API key scope can refuse.
    mocks.isOrganizationOwner.mockResolvedValue(true);
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });
  });

  for (const url of urls) {
    it(`${url}: an API key without read:secrets is refused`, async () => {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { "x-test-api-key-scopes": "write:secrets" },
      });

      expect(res.statusCode).toBe(403);
      expect(mocks.getExposureForOrg).not.toHaveBeenCalled();
      expect(mocks.getExposureForUser).not.toHaveBeenCalled();
      expect(mocks.getSecretAccessHistory).not.toHaveBeenCalled();
    });

    it(`${url}: an API key with read:secrets is allowed`, async () => {
      // access-history also needs live repo admin
      if (url.includes("access-history")) {
        const { getUserRoleWithApp } = await import("../../src/utils/github");
        (getUserRoleWithApp as any).mockResolvedValueOnce("admin");
      }
      const res = await app.inject({
        method: "GET",
        url,
        headers: { "x-test-api-key-scopes": "read:secrets" },
      });

      expect(res.statusCode).toBe(200);
    });
  }
});
