/**
 * Key Rotation Service
 *
 * Re-encrypts all secrets and provider tokens with the current encryption key version.
 * Used by both the CLI script and the admin API endpoint.
 */

import { db, secrets, providerConnections, users } from "../db";
import { eq, ne, or, isNull } from "drizzle-orm";
import { getEncryptionService } from "../utils/encryption";

export interface RotationOptions {
  dryRun?: boolean;
  batchSize?: number;
}

export interface RotationCategoryResult {
  total: number;
  rotated: number;
  failed: number;
}

export interface RotationResult {
  targetVersion: number;
  secrets: RotationCategoryResult;
  providerTokens: RotationCategoryResult;
  userTokens: RotationCategoryResult;
}

async function getCurrentVersion(): Promise<number> {
  const encryptionService = await getEncryptionService();
  const result = await encryptionService.encrypt("test");
  return result.version ?? 1;
}

async function rotateSecrets(
  targetVersion: number,
  dryRun: boolean,
  batchSize: number
): Promise<RotationCategoryResult> {
  const result: RotationCategoryResult = { total: 0, rotated: 0, failed: 0 };

  const secretsToRotate = await db.query.secrets.findMany({
    where: or(ne(secrets.encryptionVersion, targetVersion), isNull(secrets.encryptionVersion)),
  });

  result.total = secretsToRotate.length;

  if (dryRun) {
    return result;
  }

  const encryptionService = await getEncryptionService();

  for (let i = 0; i < secretsToRotate.length; i += batchSize) {
    const batch = secretsToRotate.slice(i, i + batchSize);

    for (const secret of batch) {
      try {
        const decrypted = await encryptionService.decrypt({
          encryptedContent: secret.encryptedValue,
          iv: secret.iv,
          authTag: secret.authTag,
          version: secret.encryptionVersion ?? 1,
        });

        const encrypted = await encryptionService.encrypt(decrypted);

        await db
          .update(secrets)
          .set({
            encryptedValue: encrypted.encryptedContent,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            encryptionVersion: encrypted.version ?? targetVersion,
            updatedAt: new Date(),
          })
          .where(eq(secrets.id, secret.id));

        result.rotated++;
      } catch {
        result.failed++;
      }
    }
  }

  return result;
}

async function rotateProviderTokens(
  targetVersion: number,
  dryRun: boolean,
  batchSize: number
): Promise<RotationCategoryResult> {
  const result: RotationCategoryResult = { total: 0, rotated: 0, failed: 0 };

  const connectionsToRotate = await db.query.providerConnections.findMany({
    where: or(
      ne(providerConnections.accessTokenVersion, targetVersion),
      isNull(providerConnections.accessTokenVersion)
    ),
  });

  result.total = connectionsToRotate.length;

  if (dryRun) {
    return result;
  }

  const encryptionService = await getEncryptionService();

  for (let i = 0; i < connectionsToRotate.length; i += batchSize) {
    const batch = connectionsToRotate.slice(i, i + batchSize);

    for (const connection of batch) {
      try {
        const decryptedAccess = await encryptionService.decrypt({
          encryptedContent: connection.encryptedAccessToken,
          iv: connection.accessTokenIv,
          authTag: connection.accessTokenAuthTag,
          version: connection.accessTokenVersion ?? 1,
        });

        const encryptedAccess = await encryptionService.encrypt(decryptedAccess);

        const updateData: Record<string, unknown> = {
          encryptedAccessToken: encryptedAccess.encryptedContent,
          accessTokenIv: encryptedAccess.iv,
          accessTokenAuthTag: encryptedAccess.authTag,
          accessTokenVersion: encryptedAccess.version ?? targetVersion,
          updatedAt: new Date(),
        };

        if (
          connection.encryptedRefreshToken &&
          connection.refreshTokenIv &&
          connection.refreshTokenAuthTag
        ) {
          const decryptedRefresh = await encryptionService.decrypt({
            encryptedContent: connection.encryptedRefreshToken,
            iv: connection.refreshTokenIv,
            authTag: connection.refreshTokenAuthTag,
            version: connection.refreshTokenVersion ?? 1,
          });

          const encryptedRefresh = await encryptionService.encrypt(decryptedRefresh);
          updateData.encryptedRefreshToken = encryptedRefresh.encryptedContent;
          updateData.refreshTokenIv = encryptedRefresh.iv;
          updateData.refreshTokenAuthTag = encryptedRefresh.authTag;
          updateData.refreshTokenVersion = encryptedRefresh.version ?? targetVersion;
        }

        await db
          .update(providerConnections)
          .set(updateData)
          .where(eq(providerConnections.id, connection.id));

        result.rotated++;
      } catch {
        result.failed++;
      }
    }
  }

  return result;
}

async function rotateUserTokens(
  targetVersion: number,
  dryRun: boolean,
  batchSize: number
): Promise<RotationCategoryResult> {
  const result: RotationCategoryResult = { total: 0, rotated: 0, failed: 0 };

  const usersToRotate = await db.query.users.findMany({
    where: or(
      ne(users.tokenEncryptionVersion, targetVersion),
      isNull(users.tokenEncryptionVersion)
    ),
  });

  const usersWithTokens = usersToRotate.filter((u) => u.encryptedAccessToken);
  result.total = usersWithTokens.length;

  if (dryRun) {
    return result;
  }

  const encryptionService = await getEncryptionService();

  for (let i = 0; i < usersWithTokens.length; i += batchSize) {
    const batch = usersWithTokens.slice(i, i + batchSize);

    for (const user of batch) {
      try {
        if (!user.encryptedAccessToken || !user.accessTokenIv || !user.accessTokenAuthTag) {
          continue;
        }

        const decrypted = await encryptionService.decrypt({
          encryptedContent: user.encryptedAccessToken,
          iv: user.accessTokenIv,
          authTag: user.accessTokenAuthTag,
          version: user.tokenEncryptionVersion ?? 1,
        });

        const encrypted = await encryptionService.encrypt(decrypted);

        await db
          .update(users)
          .set({
            encryptedAccessToken: encrypted.encryptedContent,
            accessTokenIv: encrypted.iv,
            accessTokenAuthTag: encrypted.authTag,
            tokenEncryptionVersion: encrypted.version ?? targetVersion,
          })
          .where(eq(users.id, user.id));

        result.rotated++;
      } catch {
        result.failed++;
      }
    }
  }

  return result;
}

/**
 * Rotate all encryption keys to the current version.
 */
export async function rotateEncryptionKeys(options: RotationOptions = {}): Promise<RotationResult> {
  const { dryRun = false, batchSize = 100 } = options;

  const targetVersion = await getCurrentVersion();

  const [secretsResult, providerTokensResult, userTokensResult] = await Promise.all([
    rotateSecrets(targetVersion, dryRun, batchSize),
    rotateProviderTokens(targetVersion, dryRun, batchSize),
    rotateUserTokens(targetVersion, dryRun, batchSize),
  ]);

  return {
    targetVersion,
    secrets: secretsResult,
    providerTokens: providerTokensResult,
    userTokens: userTokensResult,
  };
}
