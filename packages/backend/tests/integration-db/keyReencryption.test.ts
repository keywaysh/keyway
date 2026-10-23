import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createUser, createVault, cleanTables, TEST_DB_URL } from "./helpers";

// A faithful stand-in for keyway-crypto: real AES-256-GCM with a versioned
// keyring (encrypt with the highest version, decrypt with the stored one),
// hex-encoded exactly like RemoteEncryptionService returns it. Only the gRPC
// hop is replaced, so key-version mistakes surface as real decrypt failures.
const keyring = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.hoisted runs before imports
  const nodeCrypto = require("crypto") as typeof import("crypto");
  const state = {
    keys: new Map<number, Buffer>(),
    // Test hooks: run before an encrypt returns / tamper with its output
    beforeEncryptReturns: null as null | ((plaintext: string) => Promise<void>),
    corruptEncryptOf: null as null | string,
  };
  const current = () => Math.max(...state.keys.keys());
  const service = {
    async encrypt(plaintext: string) {
      const version = current();
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv("aes-256-gcm", state.keys.get(version)!, iv);
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      if (state.beforeEncryptReturns) await state.beforeEncryptReturns(plaintext);
      if (state.corruptEncryptOf === plaintext) {
        state.corruptEncryptOf = null;
        ct[0] ^= 0xff;
      }
      return {
        encryptedContent: ct.toString("hex"),
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
        version,
      };
    },
    async decrypt(data: {
      encryptedContent: string;
      iv: string;
      authTag: string;
      version?: number;
    }) {
      const version = data.version ?? 1;
      const key = state.keys.get(version);
      if (!key) throw new Error(`no key found for version ${version}`);
      const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "hex"));
      decipher.setAuthTag(Buffer.from(data.authTag, "hex"));
      return Buffer.concat([
        decipher.update(Buffer.from(data.encryptedContent, "hex")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
  return {
    state,
    service,
    use(versions: number[]) {
      const all: Record<number, Buffer> = {
        1: Buffer.alloc(32, 1),
        2: Buffer.alloc(32, 2),
        3: Buffer.alloc(32, 3),
      };
      state.keys = new Map(versions.map((v) => [v, all[v]]));
    },
  };
});

vi.mock("../../src/utils/encryption", () => ({
  getEncryptionService: vi.fn(async () => keyring.service),
}));

import { db } from "../../src/db";
import {
  secrets,
  secretVersions,
  users,
  providerConnections,
  vcsAppInstallations,
  vcsAppInstallationTokens,
} from "../../src/db/schema";
import { reencryptToCurrentKey } from "../../src/services/keyReencryption";

const cleanupSql = postgres(TEST_DB_URL, { max: 1 });

const enc = (plaintext: string) => keyring.service.encrypt(plaintext);

/**
 * Seeds one row in every encrypted column set, all encrypted under the
 * keyring active at call time. Returns the plaintexts to check against.
 */
async function seedEverything() {
  const userToken = await enc("gho_user_token");
  const user = await createUser(db, {
    encryptedAccessToken: userToken.encryptedContent,
    accessTokenIv: userToken.iv,
    accessTokenAuthTag: userToken.authTag,
    tokenEncryptionVersion: userToken.version,
  });
  const vault = await createVault(db, user.id);

  const live = await enc("postgres://u:p@db/live");
  const [secret] = await db
    .insert(secrets)
    .values({
      vaultId: vault.id,
      key: "DATABASE_URL",
      environment: "production",
      encryptedValue: live.encryptedContent,
      iv: live.iv,
      authTag: live.authTag,
      encryptionVersion: live.version,
    })
    .returning();

  const trashed = await enc('multi\nline\n"quoted" é');
  const [trashedSecret] = await db
    .insert(secrets)
    .values({
      vaultId: vault.id,
      key: "OLD_KEY",
      environment: "production",
      encryptedValue: trashed.encryptedContent,
      iv: trashed.iv,
      authTag: trashed.authTag,
      encryptionVersion: trashed.version,
      deletedAt: new Date("2026-10-01T00:00:00Z"),
    })
    .returning();

  const history = await enc("postgres://u:p@db/previous");
  const [version] = await db
    .insert(secretVersions)
    .values({
      secretId: secret.id,
      vaultId: vault.id,
      versionNumber: 1,
      encryptedValue: history.encryptedContent,
      iv: history.iv,
      authTag: history.authTag,
      encryptionVersion: history.version,
    })
    .returning();

  const access = await enc("vercel_access");
  const refresh = await enc("vercel_refresh");
  const [connection] = await db
    .insert(providerConnections)
    .values({
      userId: user.id,
      provider: "vercel",
      encryptedAccessToken: access.encryptedContent,
      accessTokenIv: access.iv,
      accessTokenAuthTag: access.authTag,
      accessTokenVersion: access.version,
      encryptedRefreshToken: refresh.encryptedContent,
      refreshTokenIv: refresh.iv,
      refreshTokenAuthTag: refresh.authTag,
      refreshTokenVersion: refresh.version,
    })
    .returning();

  const [installation] = await db
    .insert(vcsAppInstallations)
    .values({
      installationId: Math.floor(Math.random() * 1e9),
      accountId: 1,
      accountLogin: "acme",
      accountType: "organization",
    })
    .returning();
  const appToken = await enc("ghs_installation_token");
  const [installationToken] = await db
    .insert(vcsAppInstallationTokens)
    .values({
      installationId: installation.id,
      encryptedToken: appToken.encryptedContent,
      tokenIv: appToken.iv,
      tokenAuthTag: appToken.authTag,
      tokenEncryptionVersion: appToken.version,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    .returning();

  return { user, vault, secret, trashedSecret, version, connection, installationToken };
}

/** Reads every encrypted value back with whatever keyring is active. */
async function readEverything(ids: Awaited<ReturnType<typeof seedEverything>>) {
  const d = keyring.service.decrypt;
  const u = (await db.query.users.findFirst({ where: eq(users.id, ids.user.id) }))!;
  const s = (await db.query.secrets.findFirst({ where: eq(secrets.id, ids.secret.id) }))!;
  const t = (await db.query.secrets.findFirst({ where: eq(secrets.id, ids.trashedSecret.id) }))!;
  const v = (await db.query.secretVersions.findFirst({
    where: eq(secretVersions.id, ids.version.id),
  }))!;
  const c = (await db.query.providerConnections.findFirst({
    where: eq(providerConnections.id, ids.connection.id),
  }))!;
  const i = (await db.query.vcsAppInstallationTokens.findFirst({
    where: eq(vcsAppInstallationTokens.id, ids.installationToken.id),
  }))!;
  return {
    versions: [
      u.tokenEncryptionVersion,
      s.encryptionVersion,
      t.encryptionVersion,
      v.encryptionVersion,
      c.accessTokenVersion,
      c.refreshTokenVersion,
      i.tokenEncryptionVersion,
    ],
    values: [
      await d({
        encryptedContent: u.encryptedAccessToken,
        iv: u.accessTokenIv,
        authTag: u.accessTokenAuthTag,
        version: u.tokenEncryptionVersion,
      }),
      await d({
        encryptedContent: s.encryptedValue,
        iv: s.iv,
        authTag: s.authTag,
        version: s.encryptionVersion,
      }),
      await d({
        encryptedContent: t.encryptedValue,
        iv: t.iv,
        authTag: t.authTag,
        version: t.encryptionVersion,
      }),
      await d({
        encryptedContent: v.encryptedValue,
        iv: v.iv,
        authTag: v.authTag,
        version: v.encryptionVersion,
      }),
      await d({
        encryptedContent: c.encryptedAccessToken,
        iv: c.accessTokenIv,
        authTag: c.accessTokenAuthTag,
        version: c.accessTokenVersion,
      }),
      await d({
        encryptedContent: c.encryptedRefreshToken!,
        iv: c.refreshTokenIv!,
        authTag: c.refreshTokenAuthTag!,
        version: c.refreshTokenVersion!,
      }),
      await d({
        encryptedContent: i.encryptedToken,
        iv: i.tokenIv,
        authTag: i.tokenAuthTag,
        version: i.tokenEncryptionVersion,
      }),
    ],
    secretRow: s,
  };
}

const PLAINTEXTS = [
  "gho_user_token",
  "postgres://u:p@db/live",
  'multi\nline\n"quoted" é',
  "postgres://u:p@db/previous",
  "vercel_access",
  "vercel_refresh",
  "ghs_installation_token",
];

async function rawSnapshot() {
  return cleanupSql`
    SELECT 'secrets' AS t, id::text, encrypted_value AS c, iv, encryption_version AS v FROM secrets
    UNION ALL SELECT 'secret_versions', id::text, encrypted_value, iv, encryption_version FROM secret_versions
    UNION ALL SELECT 'users', id::text, encrypted_access_token, access_token_iv, token_encryption_version FROM users
    UNION ALL SELECT 'provider_access', id::text, encrypted_access_token, access_token_iv, access_token_version FROM provider_connections
    UNION ALL SELECT 'provider_refresh', id::text, encrypted_refresh_token, refresh_token_iv, refresh_token_version FROM provider_connections
    UNION ALL SELECT 'vcs_tokens', id::text, encrypted_token, token_iv, token_encryption_version FROM vcs_app_installation_tokens
    ORDER BY 1, 2`;
}

beforeEach(async () => {
  vi.clearAllMocks();
  keyring.state.beforeEncryptReturns = null;
  keyring.state.corruptEncryptOf = null;
  await cleanTables(cleanupSql);
  await cleanupSql`TRUNCATE TABLE vcs_app_installations CASCADE`;
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("reencryptToCurrentKey (real DB, versioned AES-GCM keyring)", () => {
  it("moves every encrypted column set to the current key, readable once the old key is gone", async () => {
    keyring.use([2]);
    const ids = await seedEverything();

    keyring.use([2, 3]);
    const report = await reencryptToCurrentKey({ apply: true });

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
    await reencryptToCurrentKey({ apply: true });

    keyring.use([3]);
    const after = await readEverything(ids);
    expect(after.secretRow.updatedAt).toEqual(before.updatedAt);
    expect(after.secretRow.lastModifiedById).toEqual(before.lastModifiedById);
    const trashed = (await db.query.secrets.findFirst({
      where: eq(secrets.id, ids.trashedSecret.id),
    }))!;
    expect(trashed.deletedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("dry run writes nothing but proves every candidate row decrypts", async () => {
    keyring.use([2]);
    await seedEverything();
    const snapshot = await rawSnapshot();

    keyring.use([2, 3]);
    const report = await reencryptToCurrentKey({ apply: false });

    expect(await rawSnapshot()).toEqual(snapshot);
    expect(report.apply).toBe(false);
    expect(
      report.columnSets.map((c) => [c.name, c.candidates, c.reencrypted, c.failed.length])
    ).toEqual([
      ["secrets", 2, 0, 0],
      ["secret_versions", 1, 0, 0],
      ["users.access_token", 1, 0, 0],
      ["provider_connections.access_token", 1, 0, 0],
      ["provider_connections.refresh_token", 1, 0, 0],
      ["vcs_app_installation_tokens", 1, 0, 0],
    ]);
  });

  it("dry run reports rows whose key is not loaded, without writing", async () => {
    keyring.use([1]);
    const ids = await seedEverything();
    const snapshot = await rawSnapshot();

    keyring.use([2, 3]); // v1 missing: nothing can be decrypted
    const report = await reencryptToCurrentKey({ apply: false });

    expect(await rawSnapshot()).toEqual(snapshot);
    const secretsReport = report.columnSets.find((c) => c.name === "secrets")!;
    expect(secretsReport.failed.map((f) => f.id).sort()).toEqual(
      [ids.secret.id, ids.trashedSecret.id].sort()
    );
    expect(secretsReport.failed[0].error).toContain("no key found for version 1");
  });

  it("leaves rows already on the current key untouched (safe to re-run)", async () => {
    keyring.use([2]);
    await seedEverything();
    keyring.use([2, 3]);
    await reencryptToCurrentKey({ apply: true });
    const afterFirstRun = await rawSnapshot();

    const second = await reencryptToCurrentKey({ apply: true });

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
    const report = await reencryptToCurrentKey({ apply: true });

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
    const report = await reencryptToCurrentKey({ apply: true });

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
    const report = await reencryptToCurrentKey({ apply: true });

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

    const report = await reencryptToCurrentKey({ apply: true });

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
    await expect(reencryptToCurrentKey({ apply: true })).rejects.toThrow(/version/);
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
    const report = await reencryptToCurrentKey({ apply: true });

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
    const report = await reencryptToCurrentKey({ apply: true, batchSize: 3 });

    expect(report.columnSets.find((c) => c.name === "secrets")!.reencrypted).toBe(7);
    const rows =
      await cleanupSql`SELECT encryption_version AS v, count(*)::int AS n FROM secrets GROUP BY 1`;
    expect(rows.map((r) => [r.v, r.n])).toEqual([[3, 7]]);
  });
});
