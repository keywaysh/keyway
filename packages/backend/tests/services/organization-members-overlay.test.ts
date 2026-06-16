import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for `getOrganizationMembersWithGitHub`: the members roster reads live
 * from GitHub with the CALLER's token (so GitHub's own visibility applies) and
 * overlays each person's Keyway account status. The DB alone under-reports the
 * team because a member row requires a Keyway account (organization_members.user_id FK).
 */

const mocks = vi.hoisted(() => ({
  findManyMembers: vi.fn(),
  listOrgMembers: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    query: {
      organizationMembers: { findMany: mocks.findManyMembers },
    },
  },
}));

vi.mock("../../src/utils/github", () => ({
  listOrgMembers: mocks.listOrgMembers,
  // getGitHubOrgInfoWithToken is imported by the service module under test
  getGitHubOrgInfoWithToken: vi.fn(),
}));

import { getOrganizationMembersWithGitHub } from "../../src/services/organization.service";

const ORG = { id: "org-1", login: "acme" };
const TOKEN = "user-token";

// A Keyway user "alice" (github id 10) who has signed in; her DB member row.
const dbMemberAlice = {
  id: "member-alice",
  orgRole: "owner" as const,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  user: { forgeType: "github", forgeUserId: "10", username: "alice", avatarUrl: "https://a.png" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrganizationMembersWithGitHub", () => {
  it("overlays Keyway status onto the full GitHub roster", async () => {
    mocks.findManyMembers.mockResolvedValue([dbMemberAlice]);
    mocks.listOrgMembers.mockResolvedValue([
      { id: 10, login: "alice", avatar_url: "https://a.png", role: "admin" },
      { id: 20, login: "bob", avatar_url: "https://b.png", role: "member" },
      { id: 30, login: "carol", avatar_url: "https://c.png", role: "member" },
    ]);

    const result = await getOrganizationMembersWithGitHub(ORG, TOKEN);

    expect(mocks.listOrgMembers).toHaveBeenCalledWith(TOKEN, "acme");
    // All three GitHub members are returned, not just the one on Keyway.
    expect(result).toHaveLength(3);

    const alice = result.find((m) => m.username === "alice")!;
    expect(alice.onKeyway).toBe(true);
    expect(alice.role).toBe("owner"); // role comes from GitHub (admin -> owner)
    expect(alice.joinedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(alice.id).toBe("member-alice");

    const bob = result.find((m) => m.username === "bob")!;
    expect(bob.onKeyway).toBe(false);
    expect(bob.joinedAt).toBeNull();
    expect(bob.id).toBe("github:20");

    // Owners sort before members.
    expect(result[0].username).toBe("alice");
  });

  it("does not mis-attribute Keyway status across forges (same id, different forge)", async () => {
    // A GitLab member whose forgeUserId collides with a GitHub member's id.
    const gitlabBob = {
      id: "member-gitlab-bob",
      orgRole: "member" as const,
      createdAt: new Date("2025-02-01T00:00:00Z"),
      user: { forgeType: "gitlab", forgeUserId: "20", username: "bob-gl", avatarUrl: null },
    };
    mocks.findManyMembers.mockResolvedValue([dbMemberAlice, gitlabBob]);
    mocks.listOrgMembers.mockResolvedValue([
      { id: 20, login: "bob", avatar_url: "https://b.png", role: "member" },
    ]);

    const result = await getOrganizationMembersWithGitHub(ORG, TOKEN);

    const bob = result.find((m) => m.username === "bob")!;
    // Must NOT match the GitLab row that happens to share id "20".
    expect(bob.onKeyway).toBe(false);
  });

  it("falls back to Keyway-only members when no caller token is available", async () => {
    mocks.findManyMembers.mockResolvedValue([dbMemberAlice]);

    const result = await getOrganizationMembersWithGitHub(ORG, undefined);

    expect(mocks.listOrgMembers).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ username: "alice", onKeyway: true });
  });

  it("falls back to Keyway-only members when the GitHub call fails", async () => {
    mocks.findManyMembers.mockResolvedValue([dbMemberAlice]);
    mocks.listOrgMembers.mockRejectedValue(new Error("403"));

    const result = await getOrganizationMembersWithGitHub(ORG, TOKEN);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ username: "alice", onKeyway: true });
  });
});
