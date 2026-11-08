/* eslint-disable no-console -- standalone maintenance CLI: console output is the intended interface */
/**
 * Bind vaults created before forge_repo_id existed to their GitHub repository id.
 * Unbound vaults grant no access, so run this BEFORE deploying the release that
 * enforces the binding (it only fills the column, it is safe on the old code too).
 *
 * Runs inside the backend container (needs DATABASE_URL and the GitHub App credentials):
 *
 *   railway ssh -s keyway-backend -- node dist/scripts/backfill-forge-repo-ids.js
 *   railway ssh -s keyway-backend -- node dist/scripts/backfill-forge-repo-ids.js --apply
 *
 * The dry run writes nothing. Safe to re-run. See backfillForgeRepoIdsCli.ts.
 */
import { sql } from "../db";
import { runBackfillForgeRepoIds } from "./backfillForgeRepoIdsCli";

runBackfillForgeRepoIds(process.argv.slice(2), (line) => console.log(line))
  .catch((err) => {
    console.error(`\n❌ Backfill aborted: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Nothing is left half-done: the job is safe to re-run.");
    return 1;
  })
  .then(async (code) => {
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(code);
  });
