/* eslint-disable no-console -- standalone maintenance CLI: console output is the intended interface */
/**
 * Re-encrypt all stored values with the key version keyway-crypto currently
 * encrypts with (the highest version in ENCRYPTION_KEYS).
 *
 * Runs inside the backend container, which already has DATABASE_URL and
 * private-network access to keyway-crypto:
 *
 *   railway ssh -s keyway-backend -- node dist/scripts/reencrypt-keys.js            # dry run
 *   railway ssh -s keyway-backend -- node dist/scripts/reencrypt-keys.js --apply
 *
 * The dry run decrypts every row that is not on the current version and writes
 * nothing. Never prints plaintext or keys, only row ids and counts.
 */
import { sql } from "../db";
import { reencryptToCurrentKey, type ReencryptReport } from "../services/keyReencryption";

function printReport(report: ReencryptReport) {
  console.log(`Target key version: v${report.targetVersion}`);
  for (const set of report.columnSets) {
    const parts = [`candidates=${set.candidates}`];
    if (report.apply) {
      parts.push(`reencrypted=${set.reencrypted}`, `skipped_concurrent=${set.skippedConcurrent}`);
    }
    parts.push(`failed=${set.failed.length}`);
    console.log(`  ${set.name.padEnd(36)} ${parts.join("  ")}`);
    for (const f of set.failed) {
      console.log(`      ✗ ${f.id}: ${f.error}`);
    }
  }
}

const sum = (report: ReencryptReport, pick: (s: ReencryptReport["columnSets"][number]) => number) =>
  report.columnSets.reduce((n, s) => n + pick(s), 0);

async function main() {
  const apply = process.argv.includes("--apply");
  const batchArg = process.argv.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : undefined;

  console.log(apply ? "Mode: APPLY (writes re-encrypted values)" : "Mode: DRY RUN (no writes)");
  const report = await reencryptToCurrentKey({ apply, batchSize });
  printReport(report);

  const failed = sum(report, (s) => s.failed.length);
  if (!apply) {
    const candidates = sum(report, (s) => s.candidates);
    console.log(
      failed === 0
        ? `\n✅ ${candidates} row(s) to re-encrypt, all decryptable. Re-run with --apply.`
        : `\n❌ ${failed} row(s) cannot be decrypted with the loaded keys. Do not remove any key.`
    );
    return failed === 0 ? 0 : 1;
  }

  // Confirm nothing is left on an older key version.
  const remaining = sum(await reencryptToCurrentKey({ apply: false }), (s) => s.candidates);
  console.log(`\nRows still on an older key version: ${remaining}`);
  if (failed === 0 && remaining === 0) {
    console.log(
      `✅ All values are on v${report.targetVersion}. Older keys can be removed from ENCRYPTION_KEYS.`
    );
    return 0;
  }
  console.log("❌ Some rows were not re-encrypted. Keep every key and investigate the ids above.");
  return 1;
}

main()
  .then(async (code) => {
    await sql.end({ timeout: 5 });
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("Re-encryption aborted:", err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
