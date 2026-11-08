import { and, eq, isNull } from "drizzle-orm";
import { db, vaults } from "../db";
import { getRepoInfoWithApp } from "../utils/github";

/**
 * Bind vaults created before forge_repo_id existed (migration 0042) to their
 * GitHub repository id. Unbound vaults grant no access, see getUserRole.
 *
 * A vault is bound automatically only when the repository GitHub returns for its
 * name is provably the original one:
 * - it existed before the vault (a repository re-created later under the same
 *   name is a different one), and
 * - its owner is the same immutable GitHub account as the vault's organization,
 *   or as the vault's creator for a personal vault (an older repository moved
 *   into a released name by someone else passes the date check, not this one).
 * GitHub redirects a renamed or transferred repository to the same repository, so
 * a rename is followed. Everything else is listed for review and can be bound
 * explicitly with `--bind <vaultId>=<repoId>` once an operator has checked it.
 */
export interface UnboundVault {
  id: string;
  repoFullName: string;
  createdAt: Date;
  creatorForgeUserId: string;
  orgForgeOrgId: string | null;
}

export interface BackfillDeps {
  listUnboundVaults(): Promise<UnboundVault[]>;
  getRepoInfo(repoFullName: string): Promise<{
    repoId: string | null;
    fullName: string | null;
    createdAt: Date | null;
    ownerId: string | null;
  } | null>;
  isRepoIdBound(repoId: string): Promise<boolean>;
  /** Bind only if the vault is still unbound; false when nothing was updated. */
  bindVault(vaultId: string, repoId: string): Promise<boolean>;
}

export function defaultBackfillDeps(): BackfillDeps {
  return {
    listUnboundVaults: async () => {
      const rows = await db.query.vaults.findMany({
        where: and(isNull(vaults.forgeRepoId), eq(vaults.forgeType, "github")),
        columns: { id: true, repoFullName: true, createdAt: true },
        with: {
          owner: { columns: { forgeUserId: true } },
          organization: { columns: { forgeOrgId: true } },
        },
      });
      return rows.map((v) => ({
        id: v.id,
        repoFullName: v.repoFullName,
        createdAt: v.createdAt,
        creatorForgeUserId: v.owner.forgeUserId,
        orgForgeOrgId: v.organization?.forgeOrgId ?? null,
      }));
    },
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

/** `--bind <vaultId>=<repoId>` pairs given on the command line (operator-reviewed). */
function parseExplicitBindings(args: string[]): Map<string, string> | string {
  const bindings = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--bind") {
      continue;
    }
    const pair = args[i + 1] ?? "";
    const match = /^([A-Za-z0-9-]{1,64})=([0-9]{1,20})$/.exec(pair);
    if (!match) {
      return `invalid --bind "${pair}": expected <vaultId>=<numeric repository id>`;
    }
    bindings.set(match[1], match[2]);
    i++;
  }
  return bindings;
}

export async function runBackfillForgeRepoIds(
  args: string[],
  log: (line: string) => void,
  deps: BackfillDeps = defaultBackfillDeps()
): Promise<number> {
  const apply = args.includes("--apply");
  const explicit = parseExplicitBindings(args);
  if (typeof explicit === "string") {
    log(explicit);
    return 1;
  }

  const unbound = await deps.listUnboundVaults();
  const dryRun = apply ? "" : " (dry run, pass --apply to write)";

  // Explicit, operator-reviewed bindings: only these vaults are touched
  if (explicit.size > 0) {
    const byId = new Map(unbound.map((v) => [v.id, v]));
    for (const vaultId of explicit.keys()) {
      if (!byId.has(vaultId)) {
        log(`--bind ${vaultId}: no unbound vault with this id`);
        return 1;
      }
    }
    for (const [vaultId, repoId] of explicit) {
      const vault = byId.get(vaultId)!;
      if (await deps.isRepoIdBound(repoId)) {
        log(
          `  skip ${vaultId} ${vault.repoFullName}: repository #${repoId} is already bound to another vault`
        );
        continue;
      }
      if (!apply) {
        log(`  would bind ${vaultId} ${vault.repoFullName} -> #${repoId} (explicit)${dryRun}`);
      } else if (await deps.bindVault(vaultId, repoId)) {
        log(`  bound ${vaultId} ${vault.repoFullName} -> #${repoId} (explicit)`);
      } else {
        log(`  skip ${vaultId} ${vault.repoFullName}: was bound concurrently`);
      }
    }
    return 0;
  }

  log(`${unbound.length} vault(s) without a repository id${dryRun}`);

  let bound = 0;
  let skipped = 0;
  const skip = (vault: UnboundVault, reason: string) => {
    skipped++;
    log(`  skip ${vault.id} ${vault.repoFullName}: ${reason}`);
  };

  for (const vault of unbound) {
    const info = await deps.getRepoInfo(vault.repoFullName);
    if (!info?.repoId) {
      skip(vault, "unresolved (repo deleted, private to the App, or App not installed)");
      continue;
    }
    if (!info.createdAt) {
      skip(vault, "no creation date from GitHub, cannot verify it is the original repo");
      continue;
    }
    if (info.createdAt.getTime() > vault.createdAt.getTime()) {
      skip(
        vault,
        `repository ${info.fullName ?? ""} (#${info.repoId}) was created after the vault: not the original`
      );
      continue;
    }
    if (!info.ownerId) {
      skip(vault, "no owner id from GitHub, cannot verify who owns the repository");
      continue;
    }
    const expectedOwner = vault.orgForgeOrgId ?? vault.creatorForgeUserId;
    if (info.ownerId !== expectedOwner) {
      skip(
        vault,
        `repository ${info.fullName ?? ""} (#${info.repoId}) is owned by account #${info.ownerId}, ` +
          "neither the vault's org nor its creator: review it, then --bind it explicitly"
      );
      continue;
    }
    if (await deps.isRepoIdBound(info.repoId)) {
      skip(vault, `repository #${info.repoId} is already bound to another vault`);
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
      skip(vault, "was bound concurrently");
    }
  }

  log(`${apply ? "Bound" : "Would bind"} ${bound}, skipped ${skipped}.`);
  if (skipped > 0) {
    log(
      "Skipped vaults stay inaccessible until bound: review them, then use --bind <vaultId>=<repoId>."
    );
  }
  return 0;
}
