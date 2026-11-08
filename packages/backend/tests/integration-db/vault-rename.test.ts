import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { createUser, createVault, cleanTables, findVaultById, TEST_DB_URL } from "./helpers";

// Mock only external services (GitHub API), NOT the database
vi.mock("../../src/utils/github", () => ({
  getUserRoleWithApp: vi.fn().mockResolvedValue("admin"),
  getRepoInfoWithApp: vi.fn().mockResolvedValue({
    repoId: "777",
    isPrivate: false,
    isOrganization: false,
  }),
}));

// Mock shared logger to reduce noise
vi.mock("../../src/utils/sharedLogger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the real db and services (connected to test postgres)
import { db } from "../../src/db";
import { vaults } from "../../src/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getVaultByRepoInternal,
} from "../../src/services/vault.service";

const cleanupSql = postgres(TEST_DB_URL, { max: 1 });

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanTables(cleanupSql);
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("Vault rename handling (real DB)", () => {
  // =========================================================================
  // 1. Fallback by forgeRepoId
  // =========================================================================
  it("should find vault by forgeRepoId when repoFullName has changed", async () => {
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "12345",
      fullName: "owner/new-name",
      isPrivate: false,
      isOrganization: false,
    });

    const user = await createUser(db);
    await createVault(db, user.id, {
      repoFullName: "owner/old-name",
      forgeRepoId: "12345",
    });

    // Query with the NEW name — should find via forgeRepoId fallback
    const result = await getVaultByRepoInternal("owner/new-name");

    expect(result).toBeDefined();
    expect(result!.forgeRepoId).toBe("12345");
  });

  // =========================================================================
  // 2. Self-heal persists in DB
  // =========================================================================
  it("should update repoFullName in DB after fallback (self-heal)", async () => {
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "22222",
      fullName: "owner/new-name",
      isPrivate: false,
      isOrganization: false,
    });

    const user = await createUser(db);
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/old-name",
      forgeRepoId: "22222",
    });

    // Trigger fallback
    await getVaultByRepoInternal("owner/new-name");

    // Verify the DB was actually updated
    const updated = await findVaultById(db, vault.id);
    expect(updated!.repoFullName).toBe("owner/new-name");
  });

  it("self-heals to GitHub's canonical name, never to the requested alias", async () => {
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "22223",
      fullName: "owner/new-name-2",
      isPrivate: false,
      isOrganization: false,
    });

    const user = await createUser(db);
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/old-name-2",
      forgeRepoId: "22223",
    });

    // A different casing (or any alias GitHub resolves) must not become the stored name
    const result = await getVaultByRepoInternal("OWNER/New-Name-2");

    expect(result!.repoFullName).toBe("owner/new-name-2");
    const updated = await findVaultById(db, vault.id);
    expect(updated!.repoFullName).toBe("owner/new-name-2");
  });

  // =========================================================================
  // 3. Backfill script (no lazy backfill on access any more)
  // =========================================================================
  it("does not bind an unbound vault on access", async () => {
    const user = await createUser(db);
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/my-repo",
      forgeRepoId: null,
    });

    const result = await getVaultByRepoInternal("owner/my-repo");
    expect(result).toBeDefined();

    await new Promise((r) => setTimeout(r, 200));
    const after = await findVaultById(db, vault.id);
    expect(after!.forgeRepoId).toBeNull();
  });

  it("backfill script binds a vault to an older repository owned by its creator", async () => {
    const user = await createUser(db);
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "33333",
      fullName: "owner/my-repo-2",
      createdAt: new Date("2000-01-01T00:00:00Z"),
      ownerId: user.forgeUserId,
      isPrivate: false,
      isOrganization: false,
    });
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/my-repo-2",
      forgeRepoId: null,
    });

    const { runBackfillForgeRepoIds } = await import("../../src/scripts/backfillForgeRepoIdsCli");
    const lines: string[] = [];
    await runBackfillForgeRepoIds(["--apply"], (l) => lines.push(l));

    const updated = await findVaultById(db, vault.id);
    expect(updated!.forgeRepoId, lines.join("\n")).toBe("33333");
  });

  it("backfill script refuses a repository created after the vault", async () => {
    const user = await createUser(db);
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "33334",
      fullName: "owner/reused-name",
      // well after the vault, whatever the DB server's timezone (created_at has no time zone)
      createdAt: new Date(Date.now() + 2 * 24 * 60 * 60_000),
      ownerId: user.forgeUserId,
      isPrivate: false,
      isOrganization: false,
    });
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/reused-name",
      forgeRepoId: null,
    });

    const { runBackfillForgeRepoIds } = await import("../../src/scripts/backfillForgeRepoIdsCli");
    await runBackfillForgeRepoIds(["--apply"], () => {});

    const updated = await findVaultById(db, vault.id);
    expect(updated!.forgeRepoId).toBeNull();
  });

  it("backfill script leaves for review an older repository owned by someone else", async () => {
    const user = await createUser(db);
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "33335",
      fullName: "owner/moved-in",
      createdAt: new Date("2000-01-01T00:00:00Z"),
      ownerId: "not-the-creator",
      isPrivate: false,
      isOrganization: false,
    });
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/moved-in",
      forgeRepoId: null,
    });

    const { runBackfillForgeRepoIds } = await import("../../src/scripts/backfillForgeRepoIdsCli");
    await runBackfillForgeRepoIds(["--apply"], () => {});
    expect((await findVaultById(db, vault.id))!.forgeRepoId).toBeNull();

    // After review, the operator binds it explicitly
    await runBackfillForgeRepoIds(["--apply", "--bind", `${vault.id}=33335`], () => {});
    expect((await findVaultById(db, vault.id))!.forgeRepoId).toBe("33335");
  });

  // =========================================================================
  // 4. Webhook repository.renamed
  // =========================================================================
  it("should update repoFullName via direct DB update (simulating webhook)", async () => {
    const user = await createUser(db);
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/before-rename",
      forgeRepoId: "44444",
    });

    // Simulate what the webhook handler does
    await db
      .update(vaults)
      .set({ repoFullName: "owner/after-rename", updatedAt: new Date() })
      .where(
        and(eq(vaults.forgeRepoId, "44444"), eq(vaults.forgeType, "github"))
      );

    const updated = await findVaultById(db, vault.id);
    expect(updated!.repoFullName).toBe("owner/after-rename");
  });

  // =========================================================================
  // 5. No cross-forge collision
  // =========================================================================
  it("should not collide when same forgeRepoId exists on different forge types", async () => {
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "55555",
      fullName: "owner/renamed-github-repo",
      isPrivate: false,
      isOrganization: false,
    });

    const user = await createUser(db);

    // Create a GitHub vault with forgeRepoId "55555"
    const githubVault = await createVault(db, user.id, {
      repoFullName: "owner/github-repo",
      forgeRepoId: "55555",
      forgeType: "github",
    });

    // Create a GitLab vault with the SAME forgeRepoId
    await createVault(db, user.id, {
      repoFullName: "owner/gitlab-repo",
      forgeRepoId: "55555",
      forgeType: "gitlab",
    });

    // Fallback should find the GitHub vault (getRepoInfoWithApp is GitHub-specific)
    const result = await getVaultByRepoInternal("owner/renamed-github-repo");

    expect(result).toBeDefined();
    expect(result!.id).toBe(githubVault.id);
    expect(result!.forgeType).toBe("github");
  });
});
