import { and, eq, isNull } from "drizzle-orm";
import { db, vaults } from "../db";
import { getRepoInfoWithApp } from "../utils/github";

/**
 * Bind vaults created before forge_repo_id existed (migration 0042) to their
 * GitHub repository id. Unbound vaults grant no access, see getUserRole.
 *
 * A vault is bound only to a repository that existed before the vault: GitHub
 * redirects a renamed or transferred repository to the same repository, but a
 * repository re-created later under the same name is a different one and must
 * never inherit the vault's secrets.
 */
export interface BackfillDeps {
  listUnboundVaults(): Promise<Array<{ id: string; repoFullName: string; createdAt: Date }>>;
  getRepoInfo(
    repoFullName: string
  ): Promise<{ repoId: string | null; fullName: string | null; createdAt: Date | null } | null>;
  isRepoIdBound(repoId: string): Promise<boolean>;
  /** Bind only if the vault is still unbound; false when nothing was updated. */
  bindVault(vaultId: string, repoId: string): Promise<boolean>;
}

export function defaultBackfillDeps(): BackfillDeps {
  return {
    listUnboundVaults: () =>
      db.query.vaults.findMany({
        where: and(isNull(vaults.forgeRepoId), eq(vaults.forgeType, "github")),
        columns: { id: true, repoFullName: true, createdAt: true },
      }),
    getRepoInfo: (repoFullName) => getRepoInfoWithApp(repoFullName).catch(() => null),
    isRepoIdBound: async (repoId) =>
      !!(await db.query.vaults.findFirst({
        where: and(eq(vaults.forgeRepoId, repoId), eq(vaults.forgeType, "github")),
        columns: { id: true },
      })),
    bindVault: async (vaultId, repoId) => {
      const updated = await db
        .update(vaults)
        .set({ forgeRepoId: repoId })
        .where(and(eq(vaults.id, vaultId), isNull(vaults.forgeRepoId)))
        .returning({ id: vaults.id });
      return updated.length > 0;
    },
  };
}

export async function runBackfillForgeRepoIds(
  args: string[],
  log: (line: string) => void,
  deps: BackfillDeps = defaultBackfillDeps()
): Promise<number> {
  const apply = args.includes("--apply");
  const unbound = await deps.listUnboundVaults();
  log(
    `${unbound.length} vault(s) without a repository id${apply ? "" : " (dry run, pass --apply to write)"}`
  );

  let bound = 0;
  let skipped = 0;
  const skip = (vaultId: string, repoFullName: string, reason: string) => {
    skipped++;
    log(`  skip ${vaultId} ${repoFullName}: ${reason}`);
  };

  for (const vault of unbound) {
    const info = await deps.getRepoInfo(vault.repoFullName);
    if (!info?.repoId) {
      skip(
        vault.id,
        vault.repoFullName,
        "unresolved (repo deleted, private to the App, or App not installed)"
      );
      continue;
    }
    if (!info.createdAt) {
      skip(
        vault.id,
        vault.repoFullName,
        "no creation date from GitHub, cannot verify it is the original repo"
      );
      continue;
    }
    if (info.createdAt.getTime() > vault.createdAt.getTime()) {
      skip(
        vault.id,
        vault.repoFullName,
        `repository ${info.fullName ?? ""} (#${info.repoId}) was created after the vault: not the original`
      );
      continue;
    }
    if (await deps.isRepoIdBound(info.repoId)) {
      skip(
        vault.id,
        vault.repoFullName,
        `repository #${info.repoId} is already bound to another vault`
      );
      continue;
    }

    if (!apply) {
      log(
        `  would bind ${vault.id} ${vault.repoFullName} -> #${info.repoId} (${info.fullName ?? "?"})`
      );
      bound++;
      continue;
    }
    if (await deps.bindVault(vault.id, info.repoId)) {
      log(`  bound ${vault.id} ${vault.repoFullName} -> #${info.repoId} (${info.fullName ?? "?"})`);
      bound++;
    } else {
      skip(vault.id, vault.repoFullName, "was bound concurrently");
    }
  }

  log(`${apply ? "Bound" : "Would bind"} ${bound}, skipped ${skipped}.`);
  if (skipped > 0) {
    log("Skipped vaults stay inaccessible until bound: check them manually.");
  }
  return 0;
}
