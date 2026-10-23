import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { DrizzleQueryError } from "drizzle-orm";
import { cleanTables, TEST_DB_URL } from "./helpers";

vi.mock("../../src/utils/encryption", async () => {
  const { keyring } = await import("./encryptedFixtures");
  return { getEncryptionService: vi.fn(async () => keyring.service) };
});

import { db } from "../../src/db";
import { secrets } from "../../src/db/schema";
import { runReencryptKeys, describeError } from "../../src/scripts/reencryptKeysCli";
import {
  keyring,
  resetKeyringHooks,
  enc,
  seedEverything,
  readEverything,
  rawSnapshot as snapshotOf,
  PLAINTEXTS,
} from "./encryptedFixtures";

const cleanupSql = postgres(TEST_DB_URL, { max: 1 });
const rawSnapshot = () => snapshotOf(cleanupSql);

async function run(args: string[]) {
  const lines: string[] = [];
  const code = await runReencryptKeys(args, (line) => lines.push(line));
  return { code, output: lines.join("\n") };
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetKeyringHooks();
  await cleanTables(cleanupSql);
  await cleanupSql`TRUNCATE TABLE vcs_app_installations CASCADE`;
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("reencrypt-keys CLI (real DB, versioned AES-GCM keyring)", () => {
  it.each([
    ["no --expect-version", ["--apply"]],
    ["--expect-version without a value", ["--apply", "--expect-version", "3"]],
    ["--expect-version=0", ["--apply", "--expect-version=0"]],
    ["--batch-size=0", ["--apply", "--expect-version=3", "--batch-size=0"]],
    ["--batch-size=", ["--apply", "--expect-version=3", "--batch-size="]],
    ["a typo in --apply", ["--aply", "--expect-version=3"]],
  ])("refuses to run with %s (exit 2, nothing written)", async (_label, args) => {
    keyring.use([2]);
    await seedEverything();
    keyring.use([2, 3]);
    const snapshot = await rawSnapshot();

    const { code } = await run(args);

    expect(code).toBe(2);
    expect(await rawSnapshot()).toEqual(snapshot);
  });

  it("aborts when keyway-crypto does not encrypt with the expected version yet", async () => {
    // The new ENCRYPTION_KEYS is staged but not deployed: crypto still on v2.
    keyring.use([1, 2]);
    await seedEverything();
    const snapshot = await rawSnapshot();

    const { code, output } = await run(["--apply", "--expect-version=3"]);

    expect(code).toBe(1);
    expect(output).toContain("v2");
    expect(output).not.toContain("can be removed");
    expect(await rawSnapshot()).toEqual(snapshot);
  });

  it("dry run: exit 0, writes nothing, says how many rows will be re-encrypted", async () => {
    keyring.use([2]);
    await seedEverything();
    keyring.use([2, 3]);
    const snapshot = await rawSnapshot();

    const { code, output } = await run(["--expect-version=3"]);

    expect(code).toBe(0);
    expect(await rawSnapshot()).toEqual(snapshot);
    expect(output).toContain("7 row(s) to re-encrypt");
    expect(output).not.toContain("can be removed");
  });

  it("apply: exit 0 once every row decrypts and is on the target version", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    keyring.use([2, 3]);

    const { code, output } = await run(["--apply", "--expect-version=3"]);

    expect(code).toBe(0);
    expect(output).toContain("Versions below v3 can be removed");
    keyring.use([3]);
    expect((await readEverything(ids)).values).toEqual(PLAINTEXTS);
  });

  it("refuses to apply when a row does not decrypt under its own label, and writes nothing", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    const wrongKey = await enc("mislabelled");
    await db.insert(secrets).values({
      vaultId: ids.vault.id,
      key: "MISLABELLED",
      encryptedValue: wrongKey.encryptedContent,
      iv: wrongKey.iv,
      authTag: wrongKey.authTag,
      encryptionVersion: 3, // labelled v3, encrypted with the v2 key
    });
    keyring.use([2, 3]);
    const snapshot = await rawSnapshot();

    const { code, output } = await run(["--apply", "--expect-version=3"]);

    expect(code).toBe(1);
    expect(output).not.toContain("can be removed");
    expect(await rawSnapshot()).toEqual(snapshot);
  });

  it("apply: exit 1 when a row could not be re-encrypted", async () => {
    keyring.use([2]);
    await seedEverything();
    keyring.use([2, 3]);
    keyring.state.corruptEncryptOf = "postgres://u:p@db/live";

    const { code, output } = await run(["--apply", "--expect-version=3"]);

    expect(code).toBe(1);
    expect(output).not.toContain("can be removed");
  });
});

describe("describeError", () => {
  it("reports the database cause without the query parameters (which hold ciphertext)", () => {
    const err = new DrizzleQueryError(
      'update "secrets" set "encrypted_value" = $1',
      ["deadbeefcafebabe", "0123456789abcdef01234567"],
      new Error("connection terminated unexpectedly")
    );

    const message = describeError(err);

    expect(message).toContain("connection terminated unexpectedly");
    expect(message).not.toContain("deadbeefcafebabe");
    expect(message).not.toContain("0123456789abcdef01234567");
  });
});
