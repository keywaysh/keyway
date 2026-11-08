import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { ApiError } from "../../src/lib/errors";

/**
 * Security regressions for /v1/vaults/:owner/:repo/permissions/*
 *
 *  - PUT/DELETE /overrides/:id must only reach overrides of the URL's vault.
 *  - The org-owner path of canManagePermissions must use a LIVE GitHub
 *        admin check, not the cached organization_members.org_role.
 *  - Audit log: create/update/delete/reset must emit `permission_changed`.
 *  - API keys can't manage permissions; read routes need read:secrets.
 */

const mocks = vi.hoisted(() => ({
  usersFindFirst: vi.fn(),
  vaultsFindFirst: vi.fn(),
  orgMembersFindFirst: vi.fn(),
  installationFindFirst: vi.fn(),
  getUserRoleWithApp: vi.fn(),
  getOrgMembership: vi.fn(),
  getInstallationToken: vi.fn(),
  findOrgInstallationViaGitHubAPI: vi.fn(),
  getOrganizationById: vi.fn(),
  createOverride: vi.fn(),
  updateOverride: vi.fn(),
  deleteOverride: vi.fn(),
  getOverridesForVault: vi.fn(),
  getOverrideById: vi.fn(),
  resetVaultOverrides: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("../../src/db", async () => {
  const schema = await vi.importActual<typeof import("../../src/db/schema")>("../../src/db/schema");
  return {
    ...schema,
    db: {
      query: {
        users: { findFirst: mocks.usersFindFirst },
        vaults: { findFirst: mocks.vaultsFindFirst },
        organizationMembers: { findFirst: mocks.orgMembersFindFirst },
        vcsAppInstallations: { findFirst: mocks.installationFindFirst },
      },
    },
  };
});

// Real requireApiKeyScope; only the token validation is stubbed. A test opts
// into API-key auth by sending x-test-api-key-scopes.
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
  getUserRoleWithApp: mocks.getUserRoleWithApp,
  getOrgMembership: mocks.getOrgMembership,
}));

vi.mock("../../src/services/github-app.service", () => ({
  getInstallationToken: mocks.getInstallationToken,
  findOrgInstallationViaGitHubAPI: mocks.findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI: vi.fn(),
}));

vi.mock("../../src/services/organization.service", () => ({
  getOrganizationById: mocks.getOrganizationById,
}));

vi.mock("../../src/services/permission-override.service", () => ({
  createOverride: mocks.createOverride,
  updateOverride: mocks.updateOverride,
  deleteOverride: mocks.deleteOverride,
  getOverridesForVault: mocks.getOverridesForVault,
  getOverrideById: mocks.getOverrideById,
  resetVaultOverrides: mocks.resetVaultOverrides,
  findApplicableOverride: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/services", () => ({
  getVaultEnvironmentNames: vi.fn().mockResolvedValue(["development", "production"]),
  logActivity: mocks.logActivity,
  detectPlatform: vi.fn().mockReturnValue("web"),
  extractRequestInfo: vi.fn().mockReturnValue({ ipAddress: "10.0.0.1", userAgent: "test" }),
}));

vi.mock("../../src/utils/permissions", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/permissions")>(
    "../../src/utils/permissions"
  );
  return { ...actual, getEffectivePermissionsForUser: vi.fn().mockResolvedValue({}) };
});

import { permissionOverridesRoutes } from "../../src/api/v1/routes/permission-overrides.routes";

// ----- fixtures -----------------------------------------------------------

const alice = {
  id: "u-alice",
  forgeType: "github",
  forgeUserId: "gh-alice",
  username: "alice",
  avatarUrl: null,
};
const TARGET_USER_ID = "33333333-3333-3333-3333-333333333333";

const vaultA = { id: "vault-a", orgId: "org-acme", repoFullName: "acme/api", ownerId: "u-other" };
// forgeOrgId: GitHub's immutable org id, what the installation must be bound to.
const org = { id: "org-acme", login: "acme", forgeOrgId: "111" };

function overrideInfo(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    environment: "production",
    targetType: "user",
    targetUser: { id: TARGET_USER_ID, username: "bob", avatarUrl: null },
    targetRole: undefined,
    canRead: true,
    canWrite: false,
    createdBy: { id: "u-alice", username: "alice" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

// Simulates the DB: ov-a lives in vault-a, ov-b lives in vault-b. A lookup
// without a vault filter (the bug) finds either one.
const store: Record<string, { vaultId: string; info: ReturnType<typeof overrideInfo> }> = {};
function seedStore() {
  for (const k of Object.keys(store)) delete store[k];
  store["ov-a"] = { vaultId: "vault-a", info: overrideInfo("ov-a") };
  store["ov-b"] = { vaultId: "vault-b", info: overrideInfo("ov-b") };
}
function lookup(id: string, vaultId?: string) {
  const row = store[id];
  if (!row) return null;
  if (vaultId !== undefined && row.vaultId !== vaultId) return null;
  return row.info;
}

function resetAll() {
  vi.clearAllMocks();
  seedStore();
  mocks.usersFindFirst.mockResolvedValue(alice);
  mocks.vaultsFindFirst.mockResolvedValue(vaultA);
  mocks.orgMembersFindFirst.mockResolvedValue(undefined);
  mocks.installationFindFirst.mockResolvedValue({ installationId: 1, accountId: 111, accountLogin: "acme" });
  mocks.findOrgInstallationViaGitHubAPI.mockResolvedValue(null);
  mocks.getInstallationToken.mockResolvedValue("install-token");
  mocks.getOrganizationById.mockResolvedValue(org);
  // Status read behind a null membership: GitHub's definitive 404 by default.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  mocks.getUserRoleWithApp.mockResolvedValue("admin");
  mocks.getOrgMembership.mockResolvedValue(null);
  mocks.getOverrideById.mockImplementation(async (id: string, vaultId?: string) => lookup(id, vaultId));
  mocks.updateOverride.mockImplementation(async (id: string, vaultIdOrBody: unknown) =>
    typeof vaultIdOrBody === "string" && lookup(id, vaultIdOrBody) ? { id } : lookup(id) ? { id } : null
  );
  mocks.deleteOverride.mockResolvedValue(undefined);
  mocks.createOverride.mockResolvedValue({ id: "ov-new" });
  mocks.getOverridesForVault.mockResolvedValue([store["ov-a"].info]);
  mocks.resetVaultOverrides.mockResolvedValue(undefined);
  mocks.logActivity.mockResolvedValue(undefined);
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send(error.toProblemDetails(request.id));
    }
    return reply.status((error as { statusCode?: number }).statusCode || 500).send({ detail: error.message });
  });
  await app.register(permissionOverridesRoutes, { prefix: "/v1/vaults" });
  await app.ready();
  return app;
}

const BASE = "/v1/vaults/acme/api/permissions";
const createPayload = {
  environment: "production",
  targetType: "user",
  targetUserId: TARGET_USER_ID,
  canRead: true,
  canWrite: true,
};

let app: FastifyInstance;
beforeEach(async () => {
  resetAll();
  app = await buildApp();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

// ============================================================================
// Scoping of PUT/DELETE /overrides/:id
// ============================================================================

describe("override id must belong to the URL's vault", () => {
  it("PUT on another vault's override returns 404 and changes nothing", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `${BASE}/overrides/ov-b`,
      payload: { canWrite: true },
    });

    expect(res.statusCode).toBe(404);
    expect(mocks.updateOverride).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("DELETE on another vault's override returns 404 and deletes nothing", async () => {
    const res = await app.inject({ method: "DELETE", url: `${BASE}/overrides/ov-b` });

    expect(res.statusCode).toBe(404);
    expect(mocks.deleteOverride).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("PUT on this vault's override passes the vault id down to the service", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `${BASE}/overrides/ov-a`,
      payload: { canWrite: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.updateOverride).toHaveBeenCalledWith("ov-a", "vault-a", { canWrite: true });
    for (const call of mocks.getOverrideById.mock.calls) {
      expect(call[1]).toBe("vault-a");
    }
  });

  it("DELETE on this vault's override passes the vault id down to the service", async () => {
    const res = await app.inject({ method: "DELETE", url: `${BASE}/overrides/ov-a` });

    expect(res.statusCode).toBe(200);
    expect(mocks.deleteOverride).toHaveBeenCalledWith("ov-a", "vault-a");
  });

  it("POST reads the created override back scoped to the vault", async () => {
    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(200);
    expect(mocks.getOverrideById).toHaveBeenCalledWith("ov-new", "vault-a");
  });
});

// ============================================================================
// stale cached org owner
// ============================================================================

describe("org-owner path uses a live GitHub admin check", () => {
  const mutations = [
    { name: "POST /overrides", method: "POST" as const, url: `${BASE}/overrides`, payload: createPayload },
    { name: "PUT /overrides/:id", method: "PUT" as const, url: `${BASE}/overrides/ov-a`, payload: { canWrite: true } },
    { name: "DELETE /overrides/:id", method: "DELETE" as const, url: `${BASE}/overrides/ov-a` },
    { name: "DELETE /reset", method: "DELETE" as const, url: `${BASE}/reset` },
  ];

  beforeEach(() => {
    // Not a repo admin: only the org-owner path can grant.
    mocks.getUserRoleWithApp.mockResolvedValue("write");
    // The DB still says "owner" (no webhook on demotion)...
    mocks.orgMembersFindFirst.mockResolvedValue({ orgId: "org-acme", userId: "u-alice", orgRole: "owner" });
  });

  for (const m of mutations) {
    it(`${m.name}: a demoted admin (live role member) is refused`, async () => {
      // ...but GitHub says she is only a member now.
      mocks.getOrgMembership.mockResolvedValue({ role: "member", state: "active" });

      const res = await app.inject({ method: m.method, url: m.url, payload: m.payload });

      expect(res.statusCode).toBe(403);
      expect(mocks.createOverride).not.toHaveBeenCalled();
      expect(mocks.updateOverride).not.toHaveBeenCalled();
      expect(mocks.deleteOverride).not.toHaveBeenCalled();
      expect(mocks.resetVaultOverrides).not.toHaveBeenCalled();
    });
  }

  it("refuses when GitHub can't confirm the membership (fail closed)", async () => {
    mocks.getOrgMembership.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(403);
    expect(mocks.createOverride).not.toHaveBeenCalled();
  });

  it("allows a current GitHub org admin, checked with the session username", async () => {
    mocks.getOrgMembership.mockResolvedValue({ role: "admin", state: "active" });

    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(200);
    expect(mocks.getOrgMembership).toHaveBeenCalledWith("install-token", "acme", "alice");
    expect(mocks.createOverride).toHaveBeenCalledTimes(1);
  });

  it("does not grant org admin through a reclaimed org login (installation of another GitHub org)", async () => {
    // acme renamed itself and uninstalled Keyway; mallory re-registered the old
    // name "acme", installed Keyway on it and is its admin. Her installation is
    // for GitHub org 999, not the org 111 this Keyway row was created for.
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

    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(403);
    expect(mocks.getInstallationToken).not.toHaveBeenCalled();
    expect(mocks.createOverride).not.toHaveBeenCalled();
  });

  it("still allows a live repo admin without consulting the org", async () => {
    mocks.getUserRoleWithApp.mockResolvedValue("admin");

    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(200);
    expect(mocks.getOrgMembership).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Audit log — permission_changed
// ============================================================================

describe("Audit log: override changes emit permission_changed", () => {
  it("logs a create with vault, environment, target and new values", async () => {
    mocks.getOverrideById.mockImplementation(async (id: string) =>
      id === "ov-new" ? overrideInfo("ov-new", { canRead: true, canWrite: true }) : null
    );

    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(200);
    expect(mocks.logActivity).toHaveBeenCalledTimes(1);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-alice",
        action: "permission_changed",
        vaultId: "vault-a",
        platform: "web",
        ipAddress: "10.0.0.1",
        metadata: expect.objectContaining({
          operation: "override_created",
          repoFullName: "acme/api",
          overrideId: "ov-new",
          environment: "production",
          targetType: "user",
          targetUserId: TARGET_USER_ID,
          targetUsername: "bob",
          old: null,
          new: { canRead: true, canWrite: true },
        }),
      })
    );
  });

  it("logs an update with old and new values", async () => {
    store["ov-a"].info = overrideInfo("ov-a", { canRead: true, canWrite: false });
    mocks.getOverrideById
      .mockResolvedValueOnce(overrideInfo("ov-a", { canRead: true, canWrite: false }))
      .mockResolvedValueOnce(overrideInfo("ov-a", { canRead: true, canWrite: true }));

    const res = await app.inject({
      method: "PUT",
      url: `${BASE}/overrides/ov-a`,
      payload: { canWrite: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_changed",
        vaultId: "vault-a",
        metadata: expect.objectContaining({
          operation: "override_updated",
          overrideId: "ov-a",
          environment: "production",
          targetType: "user",
          targetUserId: TARGET_USER_ID,
          old: { canRead: true, canWrite: false },
          new: { canRead: true, canWrite: true },
        }),
      })
    );
  });

  it("logs a role-targeted delete with the old values", async () => {
    store["ov-a"].info = overrideInfo("ov-a", {
      targetType: "role",
      targetUser: undefined,
      targetRole: "write",
      environment: "staging",
      canRead: true,
      canWrite: true,
    });

    const res = await app.inject({ method: "DELETE", url: `${BASE}/overrides/ov-a` });

    expect(res.statusCode).toBe(200);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_changed",
        vaultId: "vault-a",
        metadata: expect.objectContaining({
          operation: "override_deleted",
          overrideId: "ov-a",
          environment: "staging",
          targetType: "role",
          targetRole: "write",
          old: { canRead: true, canWrite: true },
          new: null,
        }),
      })
    );
  });

  it("logs a reset with every removed override", async () => {
    const res = await app.inject({ method: "DELETE", url: `${BASE}/reset` });

    expect(res.statusCode).toBe(200);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_changed",
        vaultId: "vault-a",
        metadata: expect.objectContaining({
          operation: "overrides_reset",
          repoFullName: "acme/api",
          removed: [
            expect.objectContaining({
              overrideId: "ov-a",
              environment: "production",
              targetType: "user",
              targetUserId: TARGET_USER_ID,
              old: { canRead: true, canWrite: false },
            }),
          ],
        }),
      })
    );
  });

  it("does not log a refused change", async () => {
    mocks.getUserRoleWithApp.mockResolvedValue("write");

    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });

    expect(res.statusCode).toBe(403);
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });
});

// ============================================================================
// API key scopes
// ============================================================================

describe("API keys", () => {
  const ALL_SCOPES = "read:secrets,write:secrets,delete:secrets,admin:api-keys";
  const mutations = [
    { name: "POST /overrides", method: "POST" as const, url: `${BASE}/overrides`, payload: createPayload },
    { name: "PUT /overrides/:id", method: "PUT" as const, url: `${BASE}/overrides/ov-a`, payload: { canWrite: true } },
    { name: "DELETE /overrides/:id", method: "DELETE" as const, url: `${BASE}/overrides/ov-a` },
    { name: "DELETE /reset", method: "DELETE" as const, url: `${BASE}/reset` },
  ];

  for (const m of mutations) {
    it(`${m.name}: a read:secrets API key can't rewrite permissions`, async () => {
      const res = await app.inject({
        method: m.method,
        url: m.url,
        payload: m.payload,
        headers: { "x-test-api-key-scopes": "read:secrets" },
      });

      expect(res.statusCode).toBe(403);
      expect(mocks.createOverride).not.toHaveBeenCalled();
      expect(mocks.updateOverride).not.toHaveBeenCalled();
      expect(mocks.deleteOverride).not.toHaveBeenCalled();
      expect(mocks.resetVaultOverrides).not.toHaveBeenCalled();
    });

    it(`${m.name}: even a fully-scoped API key is refused`, async () => {
      const res = await app.inject({
        method: m.method,
        url: m.url,
        payload: m.payload,
        headers: { "x-test-api-key-scopes": ALL_SCOPES },
      });

      expect(res.statusCode).toBe(403);
    });
  }

  for (const path of ["/overrides", "/effective", "/defaults"]) {
    it(`GET ${path}: an API key without read:secrets is refused`, async () => {
      const res = await app.inject({
        method: "GET",
        url: `${BASE}${path}`,
        headers: { "x-test-api-key-scopes": "write:secrets" },
      });

      expect(res.statusCode).toBe(403);
    });

    it(`GET ${path}: an API key with read:secrets is allowed`, async () => {
      const res = await app.inject({
        method: "GET",
        url: `${BASE}${path}`,
        headers: { "x-test-api-key-scopes": "read:secrets" },
      });

      expect(res.statusCode).toBe(200);
    });
  }

  it("session auth (no API key) can still manage overrides", async () => {
    const res = await app.inject({ method: "POST", url: `${BASE}/overrides`, payload: createPayload });
    expect(res.statusCode).toBe(200);
  });
});
