import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import * as crypto from "crypto";

/**
 * GitHub org webhooks (organization.*, membership.*) must select the Keyway
 * org by GitHub's immutable org id (`organization.id`), never by
 * `organization.login`: logins are released by renames and re-registered by
 * other orgs, so the row holding a login can belong to a different tenant.
 * The event must also come through Keyway's installation on THAT org (stored
 * installation, matched by account id), so a roster fetched with that
 * installation is only ever written into the org it describes.
 */

const { WEBHOOK_SECRET } = vi.hoisted(() => ({ WEBHOOK_SECRET: "test-webhook-secret-org" }));

const mocks = vi.hoisted(() => ({
  getOrganizationByLogin: vi.fn(),
  getOrganizationByForgeId: vi.fn(),
  getOrCreateOrganization: vi.fn(),
  upsertOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
  syncOrganizationMembers: vi.fn(),
  getInstallationByGitHubId: vi.fn(),
  listOrgMembersWithApp: vi.fn(),
  usersFindFirst: vi.fn(),
}));

vi.mock("../../src/config", () => ({
  config: {
    github: { apiBaseUrl: "https://api.github.com" },
    githubApp: {
      webhookSecret: WEBHOOK_SECRET,
      installUrl: "https://github.com/apps/keyway-test/installations/new",
    },
  },
}));

vi.mock("../../src/middleware/auth", () => ({
  authenticateGitHub: vi.fn(),
}));

vi.mock("../../src/services", () => ({
  checkInstallationStatus: vi.fn(),
  createInstallation: vi.fn(),
  deleteInstallation: vi.fn(),
  updateInstallationStatus: vi.fn(),
  updateInstallationRepos: vi.fn(),
  getInstallationsForUser: vi.fn(),
  getInstallationByGitHubId: mocks.getInstallationByGitHubId,
  logActivity: vi.fn(),
}));

vi.mock("../../src/services/organization.service", () => ({
  getOrganizationByLogin: mocks.getOrganizationByLogin,
  getOrganizationByForgeId: mocks.getOrganizationByForgeId,
  getOrCreateOrganization: mocks.getOrCreateOrganization,
  upsertOrganizationMember: mocks.upsertOrganizationMember,
  removeOrganizationMember: mocks.removeOrganizationMember,
  syncOrganizationMembers: mocks.syncOrganizationMembers,
}));

vi.mock("../../src/utils/github", () => ({
  listOrgMembersWithApp: mocks.listOrgMembersWithApp,
  listUserOrganizations: vi.fn(),
}));

vi.mock("../../src/utils/tokenEncryption", () => ({
  decryptAccessToken: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: { query: { users: { findFirst: mocks.usersFindFirst } }, update: vi.fn() },
  users: {},
  vaults: {},
  vcsAppInstallations: {},
  vcsAppInstallationRepos: {},
}));

import { githubRoutes } from "../../src/api/v1/routes/github.routes";

/** Keyway row of GitHub org 4242, which currently holds the login acme-corp. */
const currentAcme = { id: "org-current", forgeType: "github", forgeOrgId: "4242", login: "acme-corp" };
/** Keyway row of GitHub org 98765, which held acme-corp before renaming. */
const staleAcme = { id: "org-stale", forgeType: "github", forgeOrgId: "98765", login: "acme-corp" };

/** Keyway's App installation on GitHub org 4242. */
const installationOn4242 = {
  installationId: 666,
  accountId: 4242,
  accountLogin: "acme-corp",
  accountType: "organization",
  status: "active",
};

const bob = { id: "u-bob", forgeType: "github", forgeUserId: "777", username: "bob" };

function orgEvent(action: string, extra: Record<string, unknown> = {}) {
  return {
    action,
    membership: { user: { id: 777, login: "bob" }, role: "admin", state: "active" },
    organization: { id: 4242, login: "acme-corp", avatar_url: "" },
    // Non-installation events carry only the installation id.
    installation: { id: 666 },
    ...extra,
  };
}

function membershipEvent(action: "added" | "removed") {
  return {
    action,
    member: { id: 777, login: "bob" },
    organization: { id: 4242, login: "acme-corp" },
    installation: { id: 666 },
  };
}

let app: FastifyInstance;

async function deliver(event: string, body: object) {
  const payload = JSON.stringify(body);
  const signature = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
  const res = await app.inject({
    method: "POST",
    url: "/v1/github/webhook",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": event,
      "x-github-delivery": "delivery-1",
    },
    payload,
  });
  expect(res.statusCode).toBe(200);
}

beforeEach(async () => {
  vi.clearAllMocks();
  // The login lookup would hit the stale tenant; only the id lookup is right.
  mocks.getOrganizationByLogin.mockResolvedValue(staleAcme);
  mocks.getOrganizationByForgeId.mockImplementation(async (forgeType: string, forgeOrgId: string) =>
    forgeType === "github" && forgeOrgId === "4242" ? currentAcme : null
  );
  mocks.getOrCreateOrganization.mockResolvedValue({ ...currentAcme, login: "acme-renamed" });
  mocks.getInstallationByGitHubId.mockImplementation(async (id: number) =>
    id === 666 ? installationOn4242 : undefined
  );
  mocks.usersFindFirst.mockResolvedValue(bob);
  mocks.listOrgMembersWithApp.mockResolvedValue([
    { id: 777, login: "bob", avatar_url: "", role: "admin" },
  ]);
  mocks.syncOrganizationMembers.mockResolvedValue({ added: 0, updated: 1, removed: 0 });

  app = Fastify({ logger: false });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as any).rawBody = body;
    done(null, JSON.parse(body.toString()));
  });
  await app.register(githubRoutes, { prefix: "/v1/github" });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("organization webhooks select the Keyway org by GitHub org id", () => {
  it("member_added writes into the org with that GitHub id, not the row holding the login", async () => {
    await deliver("organization", orgEvent("member_added"));

    expect(mocks.getOrganizationByForgeId).toHaveBeenCalledWith("github", "4242");
    expect(mocks.upsertOrganizationMember).toHaveBeenCalledTimes(1);
    expect(mocks.upsertOrganizationMember).toHaveBeenCalledWith("org-current", "u-bob", "owner", "active");
  });

  it("member_removed removes from the org with that GitHub id only", async () => {
    await deliver("organization", orgEvent("member_removed"));

    expect(mocks.removeOrganizationMember).toHaveBeenCalledTimes(1);
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("org-current", "u-bob");
  });

  it("ignores an event for a GitHub org Keyway doesn't know by id, even if a row holds its login", async () => {
    mocks.getOrganizationByForgeId.mockResolvedValue(null);

    await deliver("organization", orgEvent("member_added"));
    await deliver("organization", orgEvent("member_removed"));

    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("ignores an event whose installation belongs to another GitHub account", async () => {
    mocks.getInstallationByGitHubId.mockResolvedValue({ ...installationOn4242, accountId: 98765 });

    await deliver("organization", orgEvent("member_added"));

    expect(mocks.upsertOrganizationMember).not.toHaveBeenCalled();
  });

  it("ignores an event whose installation Keyway doesn't know", async () => {
    mocks.getInstallationByGitHubId.mockResolvedValue(undefined);

    await deliver("organization", orgEvent("member_removed"));

    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it("renamed records the org's new login on the row with that GitHub id", async () => {
    await deliver(
      "organization",
      orgEvent("renamed", {
        membership: undefined,
        organization: { id: 4242, login: "acme-renamed", avatar_url: "" },
        changes: { login: { from: "acme-corp" } },
      })
    );

    expect(mocks.getOrCreateOrganization).toHaveBeenCalledWith("github", "4242", "acme-renamed");
  });

  it("renamed is ignored when the installation doesn't belong to that org", async () => {
    mocks.getInstallationByGitHubId.mockResolvedValue({ ...installationOn4242, accountId: 98765 });

    await deliver(
      "organization",
      orgEvent("renamed", { organization: { id: 4242, login: "acme-renamed", avatar_url: "" } })
    );

    expect(mocks.getOrCreateOrganization).not.toHaveBeenCalled();
  });
});

describe("membership webhooks select the Keyway org by GitHub org id", () => {
  it("re-syncs the roster into the org with that GitHub id", async () => {
    await deliver("membership", membershipEvent("added"));

    expect(mocks.listOrgMembersWithApp).toHaveBeenCalledWith(666, "acme-corp");
    expect(mocks.syncOrganizationMembers).toHaveBeenCalledTimes(1);
    expect(mocks.syncOrganizationMembers.mock.calls[0][0]).toBe("org-current");
  });

  it("does not sync a roster into a row that only holds the login", async () => {
    mocks.getOrganizationByForgeId.mockResolvedValue(null);

    await deliver("membership", membershipEvent("removed"));

    expect(mocks.listOrgMembersWithApp).not.toHaveBeenCalled();
    expect(mocks.syncOrganizationMembers).not.toHaveBeenCalled();
  });

  it("does not sync when the installation belongs to another GitHub account", async () => {
    mocks.getInstallationByGitHubId.mockResolvedValue({ ...installationOn4242, accountId: 98765 });

    await deliver("membership", membershipEvent("added"));

    expect(mocks.listOrgMembersWithApp).not.toHaveBeenCalled();
    expect(mocks.syncOrganizationMembers).not.toHaveBeenCalled();
  });
});
