import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for the privilege-escalation fix in
 * `ensureOrganizationExists`. The pre-fix helper unconditionally inserted
 * `"owner"` whenever an org row was created, which let any GitHub member
 * who triggered org creation become a Keyway org owner. The fix makes the
 * caller resolve the user's true GitHub role and pass it explicitly via
 * `currentUser: { userId, keywayRole }`.
 *
 * These tests pin the contract:
 *  - no `currentUser` ⇒ no membership row inserted
 *  - explicit `keywayRole: "member"` ⇒ inserted as member, never owner
 *  - explicit `keywayRole: "owner"` ⇒ inserted as owner
 *  - existing org + new caller ⇒ uses caller-supplied role (not hardcoded)
 *  - existing membership ⇒ no-op (no privilege rewrite)
 */

// vi.mock factories are hoisted to the top of the file, so any reference
// they capture must also be hoisted via vi.hoisted().
const mocks = vi.hoisted(() => {
  const dbState = {
    insertedOrgs: [] as any[],
    insertedMembers: [] as any[],
    updatedMembers: [] as any[],
  };
  return {
    dbState,
    findFirstOrganizations: vi.fn(),
    findFirstOrganizationMembers: vi.fn(),
    getGitHubOrgInfoWithToken: vi.fn(),
  };
});

vi.mock("../../src/db", () => {
  const { dbState, findFirstOrganizations, findFirstOrganizationMembers } = mocks;

  const insertValues = vi.fn().mockImplementation((row: any) => {
    if (row.forgeOrgId !== undefined) {
      const created = { ...row, id: `org-${dbState.insertedOrgs.length + 1}` };
      dbState.insertedOrgs.push(created);
      return { returning: vi.fn().mockResolvedValue([created]) };
    }
    const created = { ...row, id: `member-${dbState.insertedMembers.length + 1}` };
    dbState.insertedMembers.push(created);
    return { returning: vi.fn().mockResolvedValue([created]) };
  });
  const dbInsert = vi.fn().mockImplementation(() => ({ values: insertValues }));

  const updateWhere = vi.fn().mockImplementation(() => ({
    returning: vi.fn().mockResolvedValue([{}]),
  }));
  const updateSet = vi.fn().mockImplementation((row: any) => {
    dbState.updatedMembers.push(row);
    return { where: updateWhere };
  });
  const dbUpdate = vi.fn().mockImplementation(() => ({ set: updateSet }));

  return {
    db: {
      query: {
        organizations: { findFirst: findFirstOrganizations },
        organizationMembers: { findFirst: findFirstOrganizationMembers },
      },
      insert: dbInsert,
      update: dbUpdate,
    },
    organizations: {
      id: "id",
      forgeType: "forgeType",
      forgeOrgId: "forgeOrgId",
      login: "login",
    },
    organizationMembers: {
      id: "id",
      orgId: "orgId",
      userId: "userId",
      orgRole: "orgRole",
    },
    activityLogs: { id: "id" },
  };
});

vi.mock("../../src/utils/github", () => ({
  getGitHubOrgInfoWithToken: mocks.getGitHubOrgInfoWithToken,
}));

vi.mock("../../src/services/activity.service", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  detectPlatform: vi.fn().mockReturnValue("api"),
  extractRequestInfo: vi.fn().mockReturnValue({ ip: null, userAgent: null }),
}));

vi.mock("../../src/services/trial.service", () => ({
  getTrialInfo: vi.fn().mockReturnValue({ status: "none" }),
  TRIAL_DURATION_DAYS: 15,
}));

// Imports must come AFTER mocks
import { ensureOrganizationExists } from "../../src/services/organization.service";

function resetState() {
  mocks.dbState.insertedOrgs.length = 0;
  mocks.dbState.insertedMembers.length = 0;
  mocks.dbState.updatedMembers.length = 0;
  mocks.findFirstOrganizations.mockReset();
  mocks.findFirstOrganizations.mockResolvedValue(undefined);
  mocks.findFirstOrganizationMembers.mockReset();
  mocks.findFirstOrganizationMembers.mockResolvedValue(undefined);
  mocks.getGitHubOrgInfoWithToken.mockReset();
}

describe("ensureOrganizationExists — privilege-escalation regression", () => {
  beforeEach(() => {
    resetState();
  });

  describe("when org does not exist", () => {
    beforeEach(() => {
      mocks.findFirstOrganizations.mockResolvedValue(undefined);
      mocks.getGitHubOrgInfoWithToken.mockResolvedValue({
        id: 98765,
        login: "acme-corp",
        name: "Acme",
        avatar_url: "https://github.com/acme.png",
      });
    });

    it("creates the org but inserts NO membership when currentUser is omitted", async () => {
      const org = await ensureOrganizationExists("acme-corp", "install-token");

      expect(org).toBeTruthy();
      expect(mocks.dbState.insertedOrgs).toHaveLength(1);
      expect(mocks.dbState.insertedMembers).toHaveLength(0);
    });

    it("inserts membership as 'member' when caller passes keywayRole='member' (the bug fix)", async () => {
      await ensureOrganizationExists("acme-corp", "install-token", {
        userId: "user-bob",
        keywayRole: "member",
      });

      expect(mocks.dbState.insertedMembers).toHaveLength(1);
      expect(mocks.dbState.insertedMembers[0]).toMatchObject({
        userId: "user-bob",
        orgRole: "member",
      });
      // Critical assertion: never silently promoted to "owner"
      expect(mocks.dbState.insertedMembers[0].orgRole).not.toBe("owner");
    });

    it("inserts membership as 'owner' when caller passes keywayRole='owner'", async () => {
      await ensureOrganizationExists("acme-corp", "install-token", {
        userId: "user-alice",
        keywayRole: "owner",
      });

      expect(mocks.dbState.insertedMembers).toHaveLength(1);
      expect(mocks.dbState.insertedMembers[0]).toMatchObject({
        userId: "user-alice",
        orgRole: "owner",
      });
    });

    it("returns null and inserts nothing when GitHub does not recognize the org", async () => {
      mocks.getGitHubOrgInfoWithToken.mockResolvedValue(null);

      const org = await ensureOrganizationExists("acme-corp", "install-token", {
        userId: "user-bob",
        keywayRole: "owner",
      });

      expect(org).toBeNull();
      expect(mocks.dbState.insertedOrgs).toHaveLength(0);
      expect(mocks.dbState.insertedMembers).toHaveLength(0);
    });
  });

  describe("when org already exists", () => {
    const existingOrg = {
      id: "org-existing",
      login: "acme-corp",
      forgeType: "github",
      forgeOrgId: "98765",
    };

    beforeEach(() => {
      mocks.findFirstOrganizations.mockResolvedValue(existingOrg);
    });

    it("inserts caller as 'member' when caller is not yet a member and passes keywayRole='member'", async () => {
      mocks.findFirstOrganizationMembers.mockResolvedValue(undefined);

      await ensureOrganizationExists("acme-corp", "install-token", {
        userId: "user-bob",
        keywayRole: "member",
      });

      expect(mocks.dbState.insertedMembers).toHaveLength(1);
      expect(mocks.dbState.insertedMembers[0]).toMatchObject({
        orgId: existingOrg.id,
        userId: "user-bob",
        orgRole: "member",
      });
    });

    it("inserts caller as 'owner' when caller is a GitHub admin (regression: pre-fix hardcoded 'member' here)", async () => {
      mocks.findFirstOrganizationMembers.mockResolvedValue(undefined);

      await ensureOrganizationExists("acme-corp", "install-token", {
        userId: "user-alice",
        keywayRole: "owner",
      });

      expect(mocks.dbState.insertedMembers).toHaveLength(1);
      expect(mocks.dbState.insertedMembers[0]).toMatchObject({
        orgId: existingOrg.id,
        userId: "user-alice",
        orgRole: "owner",
      });
    });

    it("does NOT touch membership when caller already has one", async () => {
      mocks.findFirstOrganizationMembers.mockResolvedValue({
        id: "member-existing",
        orgId: existingOrg.id,
        userId: "user-bob",
        orgRole: "member",
      });

      await ensureOrganizationExists("acme-corp", "install-token", {
        userId: "user-bob",
        keywayRole: "owner", // even an "owner" hint must not rewrite an existing row
      });

      expect(mocks.dbState.insertedMembers).toHaveLength(0);
      expect(mocks.dbState.updatedMembers).toHaveLength(0);
    });

    it("does NOT touch membership when no currentUser is provided", async () => {
      await ensureOrganizationExists("acme-corp", "install-token");

      expect(mocks.dbState.insertedMembers).toHaveLength(0);
      expect(mocks.dbState.updatedMembers).toHaveLength(0);
    });
  });
});
