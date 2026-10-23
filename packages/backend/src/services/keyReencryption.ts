/**
 * Key re-encryption service
 *
 * Moves every encrypted value in the database to the key version keyway-crypto
 * currently encrypts with, so older key versions can be removed from
 * ENCRYPTION_KEYS. Run it through `src/scripts/reencrypt-keys.ts`.
 *
 * Safety properties:
 * - Dry run by default: every candidate row is decrypted, nothing is written.
 * - A new ciphertext is decrypted back and compared before it is written.
 * - Writes are conditional on the row's IV being unchanged, so a value saved
 *   or restored concurrently by a user is never overwritten.
 * - Only ciphertext columns change (no updatedAt / lastModifiedById bump).
 * - Idempotent: rows already on the current version are not selected.
 */

import { and, eq, gt, isNotNull, isNull, ne, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  secrets,
  secretVersions,
  users,
  providerConnections,
  vcsAppInstallationTokens,
} from "../db/schema";
import { getEncryptionService, type EncryptedData } from "../utils/encryption";

export interface ReencryptOptions {
  /** Write the re-encrypted values. When false (default), only verify. */
  apply?: boolean;
  batchSize?: number;
}

export interface ColumnSetReport {
  name: string;
  /** Rows not on the target version */
  candidates: number;
  reencrypted: number;
  /** Rows changed by someone else between read and write (left as they are) */
  skippedConcurrent: number;
  failed: { id: string; error: string }[];
}

export interface ReencryptReport {
  targetVersion: number;
  apply: boolean;
  columnSets: ColumnSetReport[];
}

interface EncryptedRow {
  id: string;
  content: string | null;
  iv: string | null;
  authTag: string | null;
  version: number | null;
}

interface ColumnSet {
  name: string;
  /** IV column of this ciphertext; identifies which encrypted column the set covers. */
  iv: PgColumn;
  selectBatch(
    targetVersion: number,
    afterId: string | null,
    limit: number
  ): Promise<EncryptedRow[]>;
  /** Returns false when the row no longer holds the ciphertext that was read. */
  replace(id: string, readIv: string, encrypted: Required<EncryptedData>): Promise<boolean>;
}

function columnSet<TTable extends PgTable>(def: {
  name: string;
  table: TTable;
  id: PgColumn;
  content: PgColumn;
  iv: PgColumn;
  authTag: PgColumn;
  version: PgColumn;
  values: (e: Required<EncryptedData>) => PgUpdateSetSource<TTable>;
}): ColumnSet {
  return {
    name: def.name,
    iv: def.iv,
    async selectBatch(targetVersion, afterId, limit) {
      const conditions: (SQL | undefined)[] = [
        isNotNull(def.content),
        or(isNull(def.version), ne(def.version, targetVersion)),
        afterId ? gt(def.id, afterId) : undefined,
      ];
      const rows = await db
        .select({
          id: def.id,
          content: def.content,
          iv: def.iv,
          authTag: def.authTag,
          version: def.version,
        })
        .from(def.table as PgTable)
        .where(and(...conditions))
        .orderBy(def.id)
        .limit(limit);
      return rows as EncryptedRow[];
    },
    async replace(id, readIv, encrypted) {
      // The IV is random per encryption, so an unchanged IV means the row
      // still holds exactly the ciphertext that was read.
      const updated = await db
        .update(def.table)
        .set(def.values(encrypted))
        .where(and(eq(def.id, id), eq(def.iv, readIv)))
        .returning({ id: def.id });
      return updated.length === 1;
    },
  };
}

export const COLUMN_SETS: ColumnSet[] = [
  columnSet({
    name: "secrets",
    table: secrets,
    id: secrets.id,
    content: secrets.encryptedValue,
    iv: secrets.iv,
    authTag: secrets.authTag,
    version: secrets.encryptionVersion,
    values: (e) => ({
      encryptedValue: e.encryptedContent,
      iv: e.iv,
      authTag: e.authTag,
      encryptionVersion: e.version,
    }),
  }),
  columnSet({
    name: "secret_versions",
    table: secretVersions,
    id: secretVersions.id,
    content: secretVersions.encryptedValue,
    iv: secretVersions.iv,
    authTag: secretVersions.authTag,
    version: secretVersions.encryptionVersion,
    values: (e) => ({
      encryptedValue: e.encryptedContent,
      iv: e.iv,
      authTag: e.authTag,
      encryptionVersion: e.version,
    }),
  }),
  columnSet({
    name: "users.access_token",
    table: users,
    id: users.id,
    content: users.encryptedAccessToken,
    iv: users.accessTokenIv,
    authTag: users.accessTokenAuthTag,
    version: users.tokenEncryptionVersion,
    values: (e) => ({
      encryptedAccessToken: e.encryptedContent,
      accessTokenIv: e.iv,
      accessTokenAuthTag: e.authTag,
      tokenEncryptionVersion: e.version,
    }),
  }),
  columnSet({
    name: "provider_connections.access_token",
    table: providerConnections,
    id: providerConnections.id,
    content: providerConnections.encryptedAccessToken,
    iv: providerConnections.accessTokenIv,
    authTag: providerConnections.accessTokenAuthTag,
    version: providerConnections.accessTokenVersion,
    values: (e) => ({
      encryptedAccessToken: e.encryptedContent,
      accessTokenIv: e.iv,
      accessTokenAuthTag: e.authTag,
      accessTokenVersion: e.version,
    }),
  }),
  columnSet({
    name: "provider_connections.refresh_token",
    table: providerConnections,
    id: providerConnections.id,
    content: providerConnections.encryptedRefreshToken,
    iv: providerConnections.refreshTokenIv,
    authTag: providerConnections.refreshTokenAuthTag,
    version: providerConnections.refreshTokenVersion,
    values: (e) => ({
      encryptedRefreshToken: e.encryptedContent,
      refreshTokenIv: e.iv,
      refreshTokenAuthTag: e.authTag,
      refreshTokenVersion: e.version,
    }),
  }),
  columnSet({
    name: "vcs_app_installation_tokens",
    table: vcsAppInstallationTokens,
    id: vcsAppInstallationTokens.id,
    content: vcsAppInstallationTokens.encryptedToken,
    iv: vcsAppInstallationTokens.tokenIv,
    authTag: vcsAppInstallationTokens.tokenAuthTag,
    version: vcsAppInstallationTokens.tokenEncryptionVersion,
    values: (e) => ({
      encryptedToken: e.encryptedContent,
      tokenIv: e.iv,
      tokenAuthTag: e.authTag,
      tokenEncryptionVersion: e.version,
    }),
  }),
];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Re-encrypt every value that is not on the key version keyway-crypto
 * currently encrypts with. Never logs or returns plaintext.
 */
export async function reencryptToCurrentKey(
  options: ReencryptOptions = {}
): Promise<ReencryptReport> {
  const { apply = false, batchSize = 100 } = options;
  const encryption = await getEncryptionService();

  const probe = await encryption.encrypt("keyway-reencrypt-probe");
  if (!probe.version) {
    throw new Error("Crypto service did not report a key version");
  }
  const targetVersion = probe.version;

  const report: ReencryptReport = { targetVersion, apply, columnSets: [] };

  for (const set of COLUMN_SETS) {
    const result: ColumnSetReport = {
      name: set.name,
      candidates: 0,
      reencrypted: 0,
      skippedConcurrent: 0,
      failed: [],
    };
    report.columnSets.push(result);

    let afterId: string | null = null;
    for (;;) {
      const batch = await set.selectBatch(targetVersion, afterId, batchSize);
      if (batch.length === 0) {
        break;
      }
      afterId = batch[batch.length - 1].id;

      for (const row of batch) {
        result.candidates++;
        const { content, iv, authTag } = row;
        if (content === null || iv === null || authTag === null) {
          result.failed.push({
            id: row.id,
            error: "incomplete ciphertext (missing iv or auth tag)",
          });
          continue;
        }
        let plaintext: string;
        try {
          plaintext = await encryption.decrypt({
            encryptedContent: content,
            iv,
            authTag,
            version: row.version ?? 1,
          });
        } catch (err) {
          result.failed.push({
            id: row.id,
            error: `decrypt v${row.version ?? 1}: ${errorMessage(err)}`,
          });
          continue;
        }
        if (!apply) {
          continue;
        }

        const encrypted = await encryption.encrypt(plaintext);
        if (encrypted.version !== targetVersion) {
          // keyway-crypto was reconfigured mid-run: stop rather than guess.
          throw new Error(
            `Crypto service now encrypts with key version ${encrypted.version}, expected ${targetVersion}. ` +
              "Nothing was written for the current row; re-run the job."
          );
        }

        try {
          const roundTrip = await encryption.decrypt(encrypted);
          if (roundTrip !== plaintext) {
            throw new Error("round-trip mismatch");
          }
        } catch (err) {
          result.failed.push({
            id: row.id,
            error: `verify v${targetVersion}: ${errorMessage(err)}`,
          });
          continue;
        }

        const written = await set.replace(row.id, iv, { ...encrypted, version: targetVersion });
        if (written) {
          result.reencrypted++;
        } else {
          result.skippedConcurrent++;
        }
      }
    }
  }

  return report;
}
