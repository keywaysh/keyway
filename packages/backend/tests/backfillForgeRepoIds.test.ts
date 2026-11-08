import { describe, it, expect, vi } from "vitest";
import { runBackfillForgeRepoIds, type BackfillDeps } from "../src/scripts/backfillForgeRepoIdsCli";

const CREATOR = "1001";
const ORG = "2002";

const vault = (
  id: string,
  repoFullName: string,
  createdAt: string,
  extra: { creatorForgeUserId?: string; orgForgeOrgId?: string | null } = {}
) => ({
  id,
  repoFullName,
  createdAt: new Date(createdAt),
  creatorForgeUserId: extra.creatorForgeUserId ?? CREATOR,
  orgForgeOrgId: extra.orgForgeOrgId ?? null,
});

const repo = (o: Record<string, unknown>) => ({
  repoId: "42",
  fullName: "acme/api",
  createdAt: new Date("2024-01-01"),
  ownerId: CREATOR,
  ...o,
});

function makeDeps(overrides: Partial<BackfillDeps> = {}): BackfillDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    listUnboundVaults: vi.fn().mockResolvedValue([]),
    getRepoInfo: vi.fn().mockResolvedValue(null),
    isRepoIdBound: vi.fn().mockResolvedValue(false),
    bindVault: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function run(args: string[], deps: ReturnType<typeof makeDeps>) {
  return runBackfillForgeRepoIds(args, (line) => deps.lines.push(line), deps);
}

describe("backfill forge repo ids", () => {
  it("binds nothing in dry-run mode", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v1", "acme/api", "2025-06-01")]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({})),
    });

    expect(await run([], deps)).toBe(0);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join("\n")).toMatch(/would bind.*v1.*42/);
  });

  it("binds a personal vault whose repository is owned by the vault's creator", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v1", "acme/api", "2025-06-01")]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({ ownerId: CREATOR })),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).toHaveBeenCalledWith("v1", "42");
  });

  it("binds an org vault whose repository is owned by the vault's org", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi
        .fn()
        .mockResolvedValue([vault("v1", "acme/api", "2025-06-01", { orgForgeOrgId: ORG })]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({ ownerId: ORG })),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).toHaveBeenCalledWith("v1", "42");
  });

  it("follows a rename: GitHub only redirects to the same repository", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v1", "acme/old", "2025-06-01")]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({ fullName: "acme/new" })),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).toHaveBeenCalledWith("v1", "42");
  });

  it("leaves for review an older repository owned by another account (moved into the name)", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v1", "acme/api", "2025-06-01")]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({ ownerId: "9999" })),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join("\n")).toMatch(/v1.*neither the vault's org nor its creator/);
  });

  it("refuses a repository created after the vault (name reused by another repo)", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v1", "acme/api", "2025-06-01")]),
      getRepoInfo: vi
        .fn()
        .mockResolvedValue(repo({ repoId: "99", createdAt: new Date("2025-09-01") })),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join("\n")).toMatch(/v1.*created after the vault/);
  });

  it("skips vaults it cannot verify", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi
        .fn()
        .mockResolvedValue([
          vault("gone", "acme/deleted", "2025-06-01"),
          vault("nodate", "acme/nodate", "2025-06-01"),
          vault("noowner", "acme/noowner", "2025-06-01"),
        ]),
      getRepoInfo: vi.fn().mockImplementation(async (name: string) => {
        if (name === "acme/nodate") return repo({ repoId: "7", fullName: name, createdAt: null });
        if (name === "acme/noowner") return repo({ repoId: "8", fullName: name, ownerId: null });
        return null;
      }),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    const out = deps.lines.join("\n");
    expect(out).toMatch(/gone.*unresolved/);
    expect(out).toMatch(/nodate.*no creation date/);
    expect(out).toMatch(/noowner.*no owner id/);
  });

  it("skips a repository id already bound to another vault", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v2", "acme/api", "2025-06-01")]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({})),
      isRepoIdBound: vi.fn().mockResolvedValue(true),
    });

    await run(["--apply"], deps);
    expect(deps.bindVault).not.toHaveBeenCalled();
    expect(deps.lines.join("\n")).toMatch(/v2.*already bound to another vault/);
  });

  it("binds a reviewed vault given explicitly with --bind, and only that one", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi
        .fn()
        .mockResolvedValue([
          vault("v1", "acme/api", "2025-06-01"),
          vault("v2", "acme/other", "2025-06-01"),
        ]),
      getRepoInfo: vi.fn().mockResolvedValue(repo({ ownerId: "9999" })),
    });

    await run(["--apply", "--bind", "v1=1234"], deps);
    expect(deps.bindVault).toHaveBeenCalledTimes(1);
    expect(deps.bindVault).toHaveBeenCalledWith("v1", "1234");
    expect(deps.getRepoInfo).not.toHaveBeenCalled();
  });

  it("refuses a --bind for a vault that is not unbound or a malformed one", async () => {
    const deps = makeDeps({
      listUnboundVaults: vi.fn().mockResolvedValue([vault("v1", "acme/api", "2025-06-01")]),
    });

    expect(await run(["--apply", "--bind", "unknown=1234"], deps)).toBe(1);
    expect(await run(["--apply", "--bind", "v1=not-a-number"], deps)).toBe(1);
    expect(deps.bindVault).not.toHaveBeenCalled();
  });
});
