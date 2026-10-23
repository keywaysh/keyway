/**
 * Logic of the `reencrypt-keys` maintenance CLI (entry point: reencrypt-keys.ts).
 * Kept separate from the entry point so it can be tested in-process.
 *
 * Exit codes: 0 = done / safe, 1 = not safe (keep every key), 2 = bad usage.
 */
import { DrizzleQueryError } from "drizzle-orm";
import {
  getCurrentKeyVersion,
  reencryptToCurrentKey,
  verifyAllRows,
  type VerifyReport,
} from "../services/keyReencryption";

const USAGE = `Usage: node dist/scripts/reencrypt-keys.js --expect-version=N [--apply] [--batch-size=N]

  --expect-version=N  required: the key version keyway-crypto must currently encrypt with
                      (the highest version in ENCRYPTION_KEYS). Aborts if it differs.
  --apply             write re-encrypted values (default: dry run, decrypts every row, writes nothing)
  --batch-size=N      rows per page (default 100)`;

interface CliOptions {
  apply: boolean;
  expectVersion: number;
  batchSize?: number;
}

function parseArgs(args: string[]): CliOptions | null {
  let apply = false;
  let expectVersion: number | undefined;
  let batchSize: number | undefined;
  for (const arg of args) {
    const value = /^--(expect-version|batch-size)=([1-9]\d*)$/.exec(arg);
    if (arg === "--apply") {
      apply = true;
    } else if (value?.[1] === "expect-version") {
      expectVersion = Number(value[2]);
    } else if (value?.[1] === "batch-size") {
      batchSize = Number(value[2]);
    } else {
      return null;
    }
  }
  return expectVersion === undefined ? null : { apply, expectVersion, batchSize };
}

/** Error text safe to print: drizzle query errors embed parameters, i.e. ciphertext. */
export function describeError(err: unknown): string {
  if (err instanceof DrizzleQueryError) {
    return `database query failed: ${err.cause?.message ?? "unknown cause"}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function printVerify(report: VerifyReport, print: (line: string) => void) {
  for (const set of report.columnSets) {
    const versions = Object.entries(set.byVersion)
      .map(([version, count]) => `v${version}=${count}`)
      .join(" ");
    print(`  ${set.name.padEnd(36)} ${versions || "(empty)"}  failed=${set.failed.length}`);
    for (const f of set.failed) {
      print(`      ✗ ${f.id}: ${f.error}`);
    }
  }
}

const totals = (report: VerifyReport, target: number) => {
  let rows = 0;
  let notOnTarget = 0;
  let failed = 0;
  for (const set of report.columnSets) {
    failed += set.failed.length;
    for (const [version, count] of Object.entries(set.byVersion)) {
      rows += count;
      if (Number(version) !== target) {
        notOnTarget += count;
      }
    }
  }
  return { rows, notOnTarget, failed };
};

export async function runReencryptKeys(
  args: string[],
  print: (line: string) => void
): Promise<number> {
  const options = parseArgs(args);
  if (!options) {
    print(USAGE);
    return 2;
  }
  const { apply, expectVersion, batchSize } = options;
  print(apply ? "Mode: APPLY (writes re-encrypted values)" : "Mode: DRY RUN (no writes)");

  const current = await getCurrentKeyVersion();
  if (current !== expectVersion) {
    print(
      `❌ keyway-crypto encrypts with v${current}, expected v${expectVersion}. ` +
        "Deploy ENCRYPTION_KEYS with the new key as the highest version first. Nothing was written."
    );
    return 1;
  }
  print(`keyway-crypto encrypts with v${current} (as expected)`);

  print("\nBefore (every row decrypted under its own version):");
  const before = await verifyAllRows({ batchSize });
  printVerify(before, print);
  const pre = totals(before, current);
  if (pre.failed > 0) {
    print(
      `\n❌ ${pre.failed} row(s) cannot be decrypted with the loaded keys. Nothing was written. ` +
        "Keep every key in ENCRYPTION_KEYS and investigate the ids above."
    );
    return 1;
  }

  if (!apply) {
    print(
      `\n✅ All ${pre.rows} row(s) decrypt. ${pre.notOnTarget} row(s) to re-encrypt to v${current}. ` +
        "Re-run with --apply."
    );
    return 0;
  }

  print("\nRe-encrypting:");
  const report = await reencryptToCurrentKey({ expectVersion, batchSize });
  for (const set of report.columnSets) {
    print(
      `  ${set.name.padEnd(36)} candidates=${set.candidates}  reencrypted=${set.reencrypted}  ` +
        `skipped_concurrent=${set.skippedConcurrent}  failed=${set.failed.length}`
    );
    for (const f of set.failed) {
      print(`      ✗ ${f.id}: ${f.error}`);
    }
  }

  print("\nAfter (every row decrypted under its own version):");
  const after = await verifyAllRows({ batchSize });
  printVerify(after, print);
  const post = totals(after, current);
  if (post.failed === 0 && post.notOnTarget === 0) {
    print(
      `\n✅ All ${post.rows} row(s) decrypt and are on v${current}. ` +
        `Versions below v${current} can be removed from ENCRYPTION_KEYS (keep v${current}).`
    );
    return 0;
  }
  print(
    `\n❌ ${post.notOnTarget} row(s) still on an older version, ${post.failed} undecryptable. ` +
      "Keep every key in ENCRYPTION_KEYS; re-run --apply, then investigate any remaining ids."
  );
  return 1;
}
