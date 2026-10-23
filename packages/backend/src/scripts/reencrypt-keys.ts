/* eslint-disable no-console -- standalone maintenance CLI: console output is the intended interface */
/**
 * Re-encrypt all stored values with the key version keyway-crypto currently
 * encrypts with (the highest version in ENCRYPTION_KEYS).
 *
 * Runs inside the backend container, which already has DATABASE_URL and
 * private-network access to keyway-crypto:
 *
 *   railway ssh -s keyway-backend -- node dist/scripts/reencrypt-keys.js --expect-version=3
 *   railway ssh -s keyway-backend -- node dist/scripts/reencrypt-keys.js --expect-version=3 --apply
 *
 * The dry run decrypts every row and writes nothing. Never prints plaintext,
 * ciphertext or keys, only row ids and counts. See reencryptKeysCli.ts.
 */
import { sql } from "../db";
import { describeError, runReencryptKeys } from "./reencryptKeysCli";

runReencryptKeys(process.argv.slice(2), (line) => console.log(line))
  .catch((err) => {
    console.error(`\n❌ Re-encryption aborted: ${describeError(err)}`);
    console.error("Keep every key in ENCRYPTION_KEYS. The job is safe to re-run.");
    return 1;
  })
  .then(async (code) => {
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(code);
  });
