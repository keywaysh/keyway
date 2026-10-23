import * as nodeCrypto from "crypto";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { db } from "../../src/db";
import {
  secrets,
  secretVersions,
  users,
  providerConnections,
  vcsAppInstallations,
  vcsAppInstallationTokens,
} from "../../src/db/schema";
import { createUser, createVault } from "./helpers";

// A faithful stand-in for keyway-crypto: real AES-256-GCM with a versioned
// keyring (encrypt with the highest version, decrypt with the stored one),
// hex-encoded exactly like RemoteEncryptionService returns it. Only the gRPC
// hop is replaced, so key-version mistakes surface as real decrypt failures.
// Test files mock src/utils/encryption to return `keyring.service`.
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
  async decrypt(data: { encryptedContent: string; iv: string; authTag: string; version?: number }) {
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
export const keyring = {
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

export function resetKeyringHooks() {
  keyring.state.beforeEncryptReturns = null;
  keyring.state.corruptEncryptOf = null;
}

export const enc = (plaintext: string) => keyring.service.encrypt(plaintext);

/**
 * Seeds one row in every encrypted column set, all encrypted under the
 * keyring active at call time. Returns the plaintexts to check against.
 */
export async function seedEverything() {
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
export async function readEverything(ids: Awaited<ReturnType<typeof seedEverything>>) {
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

export const PLAINTEXTS = [
  "gho_user_token",
  "postgres://u:p@db/live",
  'multi\nline\n"quoted" é',
  "postgres://u:p@db/previous",
  "vercel_access",
  "vercel_refresh",
  "ghs_installation_token",
];

export async function rawSnapshot(sql: ReturnType<typeof postgres>) {
  return sql`
    SELECT 'secrets' AS t, id::text, encrypted_value AS c, iv, encryption_version AS v FROM secrets
    UNION ALL SELECT 'secret_versions', id::text, encrypted_value, iv, encryption_version FROM secret_versions
    UNION ALL SELECT 'users', id::text, encrypted_access_token, access_token_iv, token_encryption_version FROM users
    UNION ALL SELECT 'provider_access', id::text, encrypted_access_token, access_token_iv, access_token_version FROM provider_connections
    UNION ALL SELECT 'provider_refresh', id::text, encrypted_refresh_token, refresh_token_iv, refresh_token_version FROM provider_connections
    UNION ALL SELECT 'vcs_tokens', id::text, encrypted_token, token_iv, token_encryption_version FROM vcs_app_installation_tokens
    ORDER BY 1, 2`;
}
