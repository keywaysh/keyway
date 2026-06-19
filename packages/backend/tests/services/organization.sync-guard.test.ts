import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for the member-purge incident.
 *
 * `syncOrganizationMembers` removes any current member absent from the VCS
 * member list. In production the manual-sync path fetched that list with the
 * user-to-server token, which returns an empty/partial roster — so the sync
 * purged every member it omitted, including the owner who triggered it
 * ("You are not a member of this organization").
 *
 * The fix is a safety net: an empty VCS list is treated as a fetch failure,
 * never as "the org has zero members", so NO removals happen. These tests pin
 * that invariant and the normal removal behaviour on a non-empty list.
 */

const mocks = vi.hoisted(() => ({
  findManyMembers: vi.fn(),
  findFirstUser: vi.fn(),
  findFirstMember: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock("../../src/db", () => {
  const dbDelete = vi.fn().mockImplementation(() => ({ where: mocks.deleteWhere }));
  const insertValues = vi.fn().mockImplementation(() => ({
    returning: vi.fn().mockResolvedValue([{ id: "member-new" }]),
  }));
  const dbInsert = vi.fn().mockImplementation(() => ({ values: insertValues }));
  const updateWhere = vi.fn().mockImplementation(() => ({
    returning: vi.fn().mockResolvedValue([{ id: "member-upd" }]),
  }));
  const dbUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation(() => ({ where: updateWhere })),
  }));

  return {
    db: {
      query: {
        organizationMembers: {
          findMany: mocks.findManyMembers,
          findFirst: mocks.findFirstMember,
        },
        users: { findFirst: mocks.findFirstUser },
      },
      delete: dbDelete,
      insert: dbInsert,
      update: dbUpdate,
    },
    organizationMembers: { id: "id", orgId: "orgId", userId: "userId", orgRole: "orgRole" },
    users: { forgeType: "forgeType", forgeUserId: "forgeUserId" },
  };
});

import { syncOrganizationMembers } from "../../src/services/organization.service";

const currentMembers = [
  { userId: "u-owner", orgRole: "owner", user: { forgeUserId: "1" } },
  { userId: "u-bob", orgRole: "member", user: { forgeUserId: "2" } },
];

beforeEach(() => {
  mocks.findManyMembers.mockReset().mockResolvedValue(currentMembers);
  mocks.findFirstUser.mockReset().mockResolvedValue(undefined);
  mocks.findFirstMember.mockReset().mockResolvedValue(undefined);
  mocks.deleteWhere.mockReset().mockResolvedValue(undefined);
});

describe("syncOrganizationMembers — empty-list purge guard", () => {
  it("removes NOBODY when the VCS list is empty (the incident)", async () => {
    const result = await syncOrganizationMembers("org-1", "github", []);

    expect(mocks.deleteWhere).not.toHaveBeenCalled();
    expect(result.removed).toBe(0);
  });

  it("still removes a member genuinely absent from a non-empty VCS list", async () => {
    // VCS reports only the owner (id "1"); bob (id "2") is gone.
    const result = await syncOrganizationMembers("org-1", "github", [
      { id: "1", login: "owner", avatar_url: "", role: "admin" },
    ]);

    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
    expect(result.removed).toBe(1);
  });
});
