import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { eq, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { createUser, createVault, cleanTables, TEST_DB_URL } from "./helpers";

vi.mock("../../src/utils/encryption", async () => {
  const { keyring } = await import("./encryptedFixtures");
  return { getEncryptionService: vi.fn(async () => keyring.service) };
});

import { db } from "../../src/db";
import { secrets, secretVersions, providerConnections } from "../../src/db/schema";
import * as schema from "../../src/db/schema";
import {
  COLUMN_SETS,
  reencryptToCurrentKey,
  verifyAllRows,
} from "../../src/services/keyReencryption";
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

beforeEach(async () => {
  vi.clearAllMocks();
  resetKeyringHooks();
  await cleanTables(cleanupSql);
  await cleanupSql`TRUNCATE TABLE vcs_app_installations CASCADE`;
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("re-encryption coverage", () => {
  // Every ciphertext in the schema is stored next to an IV column ("iv" or
  // "*_iv"). If a new encrypted column is added without a matching entry in
  // COLUMN_SETS, the job would report "0 rows left on older keys" while that
  // column still depends on the old key — and removing the key would lose it.
  it("re-encrypts every column set that has an IV column in the schema", () => {
    const ivColumnsInSchema = Object.values(schema)
      .filter((value): value is PgTable => is(value, PgTable))
      .flatMap((table) => {
        const config = getTableConfig(table);
        return config.columns
          .filter((column) => column.name === "iv" || column.name.endsWith("_iv"))
          .map((column) => `${config.name}.${column.name}`);
      })
      .sort();

    const ivColumnsCovered = COLUMN_SETS.map(
      (set) => `${getTableName(set.iv.table)}.${set.iv.name}`
    ).sort();

    expect(ivColumnsCovered).toEqual(ivColumnsInSchema);
  });
});

describe("reencryptToCurrentKey (real DB, versioned AES-GCM keyring)", () => {
  it("moves every encrypted column set to the current key, readable once the old key is gone", async () => {
    keyring.use([2]);
    const ids = await seedEverything();

    keyring.use([2, 3]);
    const report = await reencryptToCurrentKey({});

    expect(report.targetVersion).toBe(3);
    expect(report.columnSets.map((c) => [c.name, c.reencrypted, c.failed.length])).toEqual([
      ["secrets", 2, 0],
      ["secret_versions", 1, 0],
      ["users.access_token", 1, 0],
      ["provider_connections.access_token", 1, 0],
      ["provider_connections.refresh_token", 1, 0],
      ["vcs_app_installation_tokens", 1, 0],
    ]);

    // The old key is retired: everything must still decrypt, and say v3.
    keyring.use([3]);
    const after = await readEverything(ids);
    expect(after.versions).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(after.values).toEqual(PLAINTEXTS);
  });

  it("does not touch secret metadata: updatedAt, lastModifiedById and trash state are preserved", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    const before = (await db.query.secrets.findFirst({ where: eq(secrets.id, ids.secret.id) }))!;

    keyring.use([2, 3]);
    await reencryptToCurrentKey({});

    keyring.use([3]);
    const after = await readEverything(ids);
    expect(after.secretRow.updatedAt).toEqual(before.updatedAt);
    expect(after.secretRow.lastModifiedById).toEqual(before.lastModifiedById);
    const trashed = (await db.query.secrets.findFirst({
      where: eq(secrets.id, ids.trashedSecret.id),
    }))!;
    expect(trashed.deletedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("re-encrypts a refresh token stored before versions were tracked (NULL version = v1)", async () => {
    keyring.use([1]);
    const user = await createUser(db);
    const access = await enc("netlify_access");
    const refresh = await enc("netlify_refresh");
    const [connection] = await db
      .insert(providerConnections)
      .values({
        userId: user.id,
        provider: "netlify",
        encryptedAccessToken: access.encryptedContent,
        accessTokenIv: access.iv,
        accessTokenAuthTag: access.authTag,
        accessTokenVersion: 1,
        encryptedRefreshToken: refresh.encryptedContent,
        refreshTokenIv: refresh.iv,
        refreshTokenAuthTag: refresh.authTag,
        refreshTokenVersion: null,
      })
      .returning();

    keyring.use([1, 3]);
    await reencryptToCurrentKey({});

    keyring.use([3]);
    const after = (await db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, connection.id),
    }))!;
    expect(after.refreshTokenVersion).toBe(3);
    expect(
      await keyring.service.decrypt({
        encryptedContent: after.encryptedRefreshToken!,
        iv: after.refreshTokenIv!,
        authTag: after.refreshTokenAuthTag!,
        version: after.refreshTokenVersion!,
      })
    ).toBe("netlify_refresh");
  });

  it("leaves rows already on the current key untouched (safe to re-run)", async () => {
    keyring.use([2]);
    await seedEverything();
    keyring.use([2, 3]);
    await reencryptToCurrentKey({});
    const afterFirstRun = await rawSnapshot();

    const second = await reencryptToCurrentKey({});

    expect(await rawSnapshot()).toEqual(afterFirstRun);
    expect(second.columnSets.every((c) => c.candidates === 0)).toBe(true);
  });

  it("keeps a value written concurrently instead of overwriting it with the stale one", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    keyring.use([2, 3]);

    // While the job re-encrypts the live secret, a user saves a new value.
    keyring.state.beforeEncryptReturns = async (plaintext) => {
      if (plaintext !== "postgres://u:p@db/live") return;
      keyring.state.beforeEncryptReturns = null;
      const fresh = await enc("postgres://u:p@db/NEW");
      await db
        .update(secrets)
        .set({
          encryptedValue: fresh.encryptedContent,
          iv: fresh.iv,
          authTag: fresh.authTag,
          encryptionVersion: fresh.version,
        })
        .where(eq(secrets.id, ids.secret.id));
    };
    const report = await reencryptToCurrentKey({});

    const secretsReport = report.columnSets.find((c) => c.name === "secrets")!;
    expect(secretsReport.skippedConcurrent).toBe(1);
    keyring.use([3]);
    const after = await readEverything(ids);
    expect(after.values[1]).toBe("postgres://u:p@db/NEW");
  });

  it("keeps a version restored concurrently from history, even though it is on the same old key", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    keyring.use([2, 3]);

    // While the job re-encrypts the live secret, a user restores the previous
    // value: restoreSecretVersion copies the v2 ciphertext from secret_versions.
    keyring.state.beforeEncryptReturns = async (plaintext) => {
      if (plaintext !== "postgres://u:p@db/live") return;
      keyring.state.beforeEncryptReturns = null;
      const previous = (await db.query.secretVersions.findFirst({
        where: eq(secretVersions.id, ids.version.id),
      }))!;
      await db
        .update(secrets)
        .set({
          encryptedValue: previous.encryptedValue,
          iv: previous.iv,
          authTag: previous.authTag,
          encryptionVersion: previous.encryptionVersion,
        })
        .where(eq(secrets.id, ids.secret.id));
    };
    const report = await reencryptToCurrentKey({});

    expect(report.columnSets.find((c) => c.name === "secrets")!.skippedConcurrent).toBe(1);
    keyring.use([2, 3]);
    expect((await readEverything(ids)).values[1]).toBe("postgres://u:p@db/previous");
  });

  it("never writes a re-encrypted value that does not decrypt back to the original", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    const snapshot = await rawSnapshot();
    keyring.use([2, 3]);

    // The re-encryption of the live secret comes back broken.
    keyring.state.corruptEncryptOf = "postgres://u:p@db/live";
    const report = await reencryptToCurrentKey({});

    const secretsReport = report.columnSets.find((c) => c.name === "secrets")!;
    expect(secretsReport.failed).toHaveLength(1);
    expect(secretsReport.reencrypted).toBe(1);
    // The failed row still holds its original v2 ciphertext.
    const failedId = secretsReport.failed[0].id;
    expect(failedId).toBe(ids.secret.id);
    const original = snapshot.find((r) => r.t === "secrets" && r.id === failedId)!;
    const now = (await rawSnapshot()).find((r) => r.t === "secrets" && r.id === failedId)!;
    expect(now).toEqual(original);
    keyring.use([2, 3]);
    expect((await readEverything(ids)).values).toEqual(PLAINTEXTS);
  });

  it("re-encrypts a refresh token independently of its access token", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    // Access token already rotated, refresh token still on v2.
    keyring.use([2, 3]);
    const access = await enc("vercel_access");
    await db
      .update(providerConnections)
      .set({
        encryptedAccessToken: access.encryptedContent,
        accessTokenIv: access.iv,
        accessTokenAuthTag: access.authTag,
        accessTokenVersion: access.version,
      })
      .where(eq(providerConnections.id, ids.connection.id));
    // A second connection with no refresh token at all.
    const lone = await enc("netlify_access");
    await db.insert(providerConnections).values({
      userId: ids.user.id,
      provider: "netlify",
      encryptedAccessToken: lone.encryptedContent,
      accessTokenIv: lone.iv,
      accessTokenAuthTag: lone.authTag,
      accessTokenVersion: lone.version,
    });

    const report = await reencryptToCurrentKey({});

    const byName = Object.fromEntries(report.columnSets.map((c) => [c.name, c.candidates]));
    expect(byName["provider_connections.access_token"]).toBe(0);
    expect(byName["provider_connections.refresh_token"]).toBe(1);
    keyring.use([3]);
    expect((await readEverything(ids)).values[5]).toBe("vercel_refresh");
    const netlify = (await db.query.providerConnections.findFirst({
      where: eq(providerConnections.provider, "netlify"),
    }))!;
    expect(netlify.encryptedRefreshToken).toBeNull();
    expect(netlify.refreshTokenVersion).toBeNull();
  });

  it("stops when the crypto service starts encrypting with an unexpected key version", async () => {
    keyring.use([2]);
    await seedEverything();
    keyring.use([2, 3]);

    // keyway-crypto gets redeployed with a v4 in the middle of the run.
    keyring.state.beforeEncryptReturns = async (plaintext) => {
      if (plaintext !== "postgres://u:p@db/live") return;
      keyring.state.beforeEncryptReturns = null;
      keyring.state.keys.set(4, Buffer.alloc(32, 4));
    };
    await expect(reencryptToCurrentKey({})).rejects.toThrow(/version/);
    // Rows are either untouched (v2) or fully re-encrypted (v3): none on v4.
    expect(new Set((await rawSnapshot()).map((r) => r.v))).toEqual(new Set([2, 3]));
  });

  it("re-encrypts a secret whose value is the empty string (empty ciphertext)", async () => {
    keyring.use([2]);
    const user = await createUser(db);
    const vault = await createVault(db, user.id);
    const empty = await enc("");
    expect(empty.encryptedContent).toBe(""); // AES-GCM of "" has no ciphertext bytes
    const [row] = await db
      .insert(secrets)
      .values({
        vaultId: vault.id,
        key: "EMPTY",
        encryptedValue: empty.encryptedContent,
        iv: empty.iv,
        authTag: empty.authTag,
        encryptionVersion: empty.version,
      })
      .returning();

    keyring.use([2, 3]);
    const report = await reencryptToCurrentKey({});

    const secretsReport = report.columnSets.find((c) => c.name === "secrets")!;
    expect(secretsReport.failed).toEqual([]);
    expect(secretsReport.reencrypted).toBe(1);
    keyring.use([3]);
    const after = (await db.query.secrets.findFirst({ where: eq(secrets.id, row.id) }))!;
    expect(after.encryptionVersion).toBe(3);
    expect(
      await keyring.service.decrypt({
        encryptedContent: after.encryptedValue,
        iv: after.iv,
        authTag: after.authTag,
        version: after.encryptionVersion,
      })
    ).toBe("");
  });

  it("pages through more rows than one batch", async () => {
    keyring.use([2]);
    const user = await createUser(db);
    const vault = await createVault(db, user.id);
    for (let n = 0; n < 7; n++) {
      const e = await enc(`value-${n}`);
      await db.insert(secrets).values({
        vaultId: vault.id,
        key: `KEY_${n}`,
        encryptedValue: e.encryptedContent,
        iv: e.iv,
        authTag: e.authTag,
        encryptionVersion: e.version,
      });
    }

    keyring.use([2, 3]);
    const report = await reencryptToCurrentKey({ batchSize: 3 });

    expect(report.columnSets.find((c) => c.name === "secrets")!.reencrypted).toBe(7);
    const rows =
      await cleanupSql`SELECT encryption_version AS v, count(*)::int AS n FROM secrets GROUP BY 1`;
    expect(rows.map((r) => [r.v, r.n])).toEqual([[3, 7]]);
  });
});

describe("verifyAllRows (real DB, versioned AES-GCM keyring)", () => {
  it("writes nothing and counts every row per key version", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    keyring.use([2, 3]);
    const fresh = await enc("already-on-v3");
    await db.insert(secrets).values({
      vaultId: ids.vault.id,
      key: "FRESH",
      encryptedValue: fresh.encryptedContent,
      iv: fresh.iv,
      authTag: fresh.authTag,
      encryptionVersion: fresh.version,
    });
    const snapshot = await rawSnapshot();

    const report = await verifyAllRows();

    expect(await rawSnapshot()).toEqual(snapshot);
    expect(report.columnSets.map((c) => [c.name, c.byVersion, c.failed.length])).toEqual([
      ["secrets", { 2: 2, 3: 1 }, 0],
      ["secret_versions", { 2: 1 }, 0],
      ["users.access_token", { 2: 1 }, 0],
      ["provider_connections.access_token", { 2: 1 }, 0],
      ["provider_connections.refresh_token", { 2: 1 }, 0],
      ["vcs_app_installation_tokens", { 2: 1 }, 0],
    ]);
  });

  it("reports rows whose key is not loaded", async () => {
    keyring.use([1]);
    const ids = await seedEverything();

    keyring.use([2, 3]); // v1 missing: nothing can be decrypted
    const report = await verifyAllRows();

    const secretsReport = report.columnSets.find((c) => c.name === "secrets")!;
    expect(secretsReport.failed.map((f) => f.id).sort()).toEqual(
      [ids.secret.id, ids.trashedSecret.id].sort()
    );
    expect(secretsReport.failed[0].error).toContain("no key found for version 1");
  });

  it("catches a row labelled with the current version but encrypted with another key", async () => {
    keyring.use([2]);
    const ids = await seedEverything();
    const wrongKey = await enc("mislabelled");
    const [mislabelled] = await db
      .insert(secrets)
      .values({
        vaultId: ids.vault.id,
        key: "MISLABELLED",
        encryptedValue: wrongKey.encryptedContent,
        iv: wrongKey.iv,
        authTag: wrongKey.authTag,
        encryptionVersion: 3, // says v3, but the ciphertext is under the v2 key
      })
      .returning();

    keyring.use([2, 3]);
    const report = await verifyAllRows();

    expect(report.columnSets.find((c) => c.name === "secrets")!.failed.map((f) => f.id)).toEqual([
      mislabelled.id,
    ]);
  });
});
