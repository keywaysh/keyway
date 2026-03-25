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

  // =========================================================================
  // 3. Lazy backfill
  // =========================================================================
  it("should backfill forgeRepoId when vault has none", async () => {
    const { getRepoInfoWithApp } = await import("../../src/utils/github");
    (getRepoInfoWithApp as any).mockResolvedValue({
      repoId: "33333",
      isPrivate: false,
      isOrganization: false,
    });

    const user = await createUser(db);
    const vault = await createVault(db, user.id, {
      repoFullName: "owner/my-repo",
      forgeRepoId: null,
    });

    // Access the vault — should trigger lazy backfill
    const result = await getVaultByRepoInternal("owner/my-repo");
    expect(result).toBeDefined();
    expect(result!.forgeRepoId).toBeNull(); // returned before backfill completes

    // Poll until backfill completes (default 5s, configurable)
    const timeoutMs = Number(process.env.INTEGRATION_DB_BACKFILL_TIMEOUT_MS ?? 5000);
    const deadline = Date.now() + timeoutMs;
    let updated;
    while (Date.now() < deadline) {
      updated = await findVaultById(db, vault.id);
      if (updated?.forgeRepoId) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(
      updated?.forgeRepoId,
      `forgeRepoId backfill did not complete within ${timeoutMs}ms`,
    ).toBe("33333");
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
