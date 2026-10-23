import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { createUser, createVault, cleanTables, TEST_DB_URL } from "./helpers";

vi.mock("../../src/utils/sharedLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { db } from "../../src/db";
import { secrets, secretVersions } from "../../src/db/schema";
import { saveSecretVersion, saveSecretVersions } from "../../src/services/secretVersion.service";

const cleanupSql = postgres(TEST_DB_URL, { max: 1 });

async function setup(keys: string[]) {
  const user = await createUser(db);
  const vault = await createVault(db, user.id);
  const rows = await db
    .insert(secrets)
    .values(
      keys.map((key) => ({
        vaultId: vault.id,
        environment: "development",
        key,
        encryptedValue: `${key}-current`,
        iv: "iv",
        authTag: "tag",
        encryptionVersion: 1,
      }))
    )
    .returning();
  return { user, vault, rows };
}

const versionsOf = async (secretIds: string[]) =>
  db
    .select()
    .from(secretVersions)
    .where(inArray(secretVersions.secretId, secretIds))
    .orderBy(secretVersions.secretId, secretVersions.versionNumber);

beforeEach(async () => {
  await cleanTables(cleanupSql);
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("saveSecretVersions", () => {
  it("archives every value, continuing each secret's numbering", async () => {
    const { user, vault, rows } = await setup(["A", "B"]);
    const [a, b] = rows;
    // A already has two versions, B none.
    await saveSecretVersion(a.id, vault.id, "a1", "iv", "tag", 1);
    await saveSecretVersion(a.id, vault.id, "a2", "iv", "tag", 1);

    await saveSecretVersions(
      rows.map((row) => ({
        secretId: row.id,
        vaultId: vault.id,
        encryptedValue: row.encryptedValue,
        iv: row.iv,
        authTag: row.authTag,
        encryptionVersion: row.encryptionVersion,
      })),
      user.id
    );

    const versions = await versionsOf([a.id, b.id]);
    expect(
      versions.map((v) => [v.secretId, v.versionNumber, v.encryptedValue, v.createdById])
    ).toEqual(
      [
        [a.id, 1, "a1", null],
        [a.id, 2, "a2", null],
        [a.id, 3, "A-current", user.id],
        [b.id, 1, "B-current", user.id],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0])) || Number(x[1]) - Number(y[1]))
    );
  });

  it("keeps the 10 most recent versions of each secret", async () => {
    const { vault, rows } = await setup(["A", "B"]);
    const [a, b] = rows;
    for (let i = 1; i <= 10; i++) {
      await saveSecretVersion(a.id, vault.id, `a${i}`, "iv", "tag", 1);
    }
    await saveSecretVersions(
      [a, b].map((row) => ({
        secretId: row.id,
        vaultId: vault.id,
        encryptedValue: row.encryptedValue,
        iv: row.iv,
        authTag: row.authTag,
        encryptionVersion: row.encryptionVersion,
      }))
    );
    const kept = await versionsOf([a.id]);
    expect(kept.map((v) => v.versionNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect((await versionsOf([b.id])).map((v) => v.versionNumber)).toEqual([1]);
  });

  it("does nothing for an empty list", async () => {
    await expect(saveSecretVersions([])).resolves.toBeUndefined();
  });

  it("runs inside the caller's transaction", async () => {
    const { vault, rows } = await setup(["A"]);
    await expect(
      db.transaction(async (tx) => {
        await saveSecretVersions(
          [
            {
              secretId: rows[0].id,
              vaultId: vault.id,
              encryptedValue: "x",
              iv: "iv",
              authTag: "tag",
              encryptionVersion: 1,
            },
          ],
          undefined,
          tx
        );
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    expect(await versionsOf([rows[0].id])).toEqual([]);
    expect(await db.query.secrets.findMany({ where: eq(secrets.id, rows[0].id) })).toHaveLength(1);
  });
});
