#!/usr/bin/env tsx
/**
 * Key Rotation Script
 *
 * Re-encrypts all secrets and provider tokens with the current encryption key version.
 *
 * Prerequisites:
 * 1. Configure ENCRYPTION_KEYS with old and new keys: "1:old_key,2:new_key"
 * 2. Deploy the crypto service with the new configuration
 * 3. Run this script to migrate data
 *
 * Usage:
 *   ENCRYPTION_KEYS="1:old_key,2:new_key" pnpm run rotate-key
 *
 * Options:
 *   --dry-run     Show what would be rotated without making changes
 *   --batch-size  Number of records to process at a time (default: 100)
 */

import { db, secrets, providerConnections, users } from '../src/db';
import { eq, ne, or, isNull } from 'drizzle-orm';
import { getEncryptionService } from '../src/utils/encryption';

interface RotationStats {
  secrets: { total: number; rotated: number; failed: number };
  providerTokens: { total: number; rotated: number; failed: number };
  userTokens: { total: number; rotated: number; failed: number };
}

const stats: RotationStats = {
  secrets: { total: 0, rotated: 0, failed: 0 },
  providerTokens: { total: 0, rotated: 0, failed: 0 },
  userTokens: { total: 0, rotated: 0, failed: 0 },
};

async function getCurrentVersion(): Promise<number> {
  const encryptionService = await getEncryptionService();
  // Encrypt a test value to get the current version
  const result = await encryptionService.encrypt('test');
  return result.version ?? 1;
}

async function rotateSecrets(targetVersion: number, dryRun: boolean, batchSize: number) {
  console.log('\n📦 Rotating secrets...');

  const secretsToRotate = await db.query.secrets.findMany({
    where: or(
      ne(secrets.encryptionVersion, targetVersion),
      isNull(secrets.encryptionVersion)
    ),
  });

  stats.secrets.total = secretsToRotate.length;
  console.log(`   Found ${secretsToRotate.length} secrets to rotate`);

  if (dryRun) {
    console.log('   [DRY RUN] Would rotate these secrets');
    return;
  }

  const encryptionService = await getEncryptionService();

  for (let i = 0; i < secretsToRotate.length; i += batchSize) {
    const batch = secretsToRotate.slice(i, i + batchSize);

    for (const secret of batch) {
      try {
        // Decrypt with old version
        const decrypted = await encryptionService.decrypt({
          encryptedContent: secret.encryptedValue,
          iv: secret.iv,
          authTag: secret.authTag,
          version: secret.encryptionVersion ?? 1,
        });

        // Re-encrypt with current version
        const encrypted = await encryptionService.encrypt(decrypted);

        // Update in database
        await db.update(secrets).set({
          encryptedValue: encrypted.encryptedContent,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          encryptionVersion: encrypted.version ?? targetVersion,
          updatedAt: new Date(),
        }).where(eq(secrets.id, secret.id));

        stats.secrets.rotated++;
      } catch (error) {
        console.error(`   ❌ Failed to rotate secret ${secret.id} (${secret.key}): ${error instanceof Error ? error.message : 'Unknown error'}`);
        stats.secrets.failed++;
      }
    }

    console.log(`   Progress: ${Math.min(i + batchSize, secretsToRotate.length)}/${secretsToRotate.length}`);
  }
}

async function rotateProviderTokens(targetVersion: number, dryRun: boolean, batchSize: number) {
  console.log('\n🔗 Rotating provider connection tokens...');

  const connectionsToRotate = await db.query.providerConnections.findMany({
    where: or(
      ne(providerConnections.accessTokenVersion, targetVersion),
      isNull(providerConnections.accessTokenVersion)
    ),
  });

  stats.providerTokens.total = connectionsToRotate.length;
  console.log(`   Found ${connectionsToRotate.length} provider connections to rotate`);

  if (dryRun) {
    console.log('   [DRY RUN] Would rotate these connections');
    return;
  }

  const encryptionService = await getEncryptionService();

  for (let i = 0; i < connectionsToRotate.length; i += batchSize) {
    const batch = connectionsToRotate.slice(i, i + batchSize);

    for (const connection of batch) {
      try {
        // Decrypt access token with old version
        const decryptedAccess = await encryptionService.decrypt({
          encryptedContent: connection.encryptedAccessToken,
          iv: connection.accessTokenIv,
          authTag: connection.accessTokenAuthTag,
          version: connection.accessTokenVersion ?? 1,
        });

        // Re-encrypt with current version
        const encryptedAccess = await encryptionService.encrypt(decryptedAccess);

        const updateData: Record<string, unknown> = {
          encryptedAccessToken: encryptedAccess.encryptedContent,
          accessTokenIv: encryptedAccess.iv,
          accessTokenAuthTag: encryptedAccess.authTag,
          accessTokenVersion: encryptedAccess.version ?? targetVersion,
          updatedAt: new Date(),
        };

        // Also rotate refresh token if present
        if (connection.encryptedRefreshToken && connection.refreshTokenIv && connection.refreshTokenAuthTag) {
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

        await db.update(providerConnections).set(updateData).where(eq(providerConnections.id, connection.id));

        stats.providerTokens.rotated++;
      } catch (error) {
        console.error(`   ❌ Failed to rotate connection ${connection.id} (${connection.provider}): ${error instanceof Error ? error.message : 'Unknown error'}`);
        stats.providerTokens.failed++;
      }
    }

    console.log(`   Progress: ${Math.min(i + batchSize, connectionsToRotate.length)}/${connectionsToRotate.length}`);
  }
}

async function rotateUserTokens(targetVersion: number, dryRun: boolean, batchSize: number) {
  console.log('\n👤 Rotating user GitHub tokens...');

  const usersToRotate = await db.query.users.findMany({
    where: or(
      ne(users.tokenEncryptionVersion, targetVersion),
      isNull(users.tokenEncryptionVersion)
    ),
  });

  // Filter to only users with encrypted tokens
  const usersWithTokens = usersToRotate.filter(u => u.encryptedAccessToken);

  stats.userTokens.total = usersWithTokens.length;
  console.log(`   Found ${usersWithTokens.length} user tokens to rotate`);

  if (dryRun) {
    console.log('   [DRY RUN] Would rotate these user tokens');
    return;
  }

  const encryptionService = await getEncryptionService();

  for (let i = 0; i < usersWithTokens.length; i += batchSize) {
    const batch = usersWithTokens.slice(i, i + batchSize);

    for (const user of batch) {
      try {
        if (!user.encryptedAccessToken || !user.accessTokenIv || !user.accessTokenAuthTag) {
          continue;
        }

        // Decrypt with old version
        const decrypted = await encryptionService.decrypt({
          encryptedContent: user.encryptedAccessToken,
          iv: user.accessTokenIv,
          authTag: user.accessTokenAuthTag,
          version: user.tokenEncryptionVersion ?? 1,
        });

        // Re-encrypt with current version
        const encrypted = await encryptionService.encrypt(decrypted);

        await db.update(users).set({
          encryptedAccessToken: encrypted.encryptedContent,
          accessTokenIv: encrypted.iv,
          accessTokenAuthTag: encrypted.authTag,
          tokenEncryptionVersion: encrypted.version ?? targetVersion,
        }).where(eq(users.id, user.id));

        stats.userTokens.rotated++;
      } catch (error) {
        console.error(`   ❌ Failed to rotate user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        stats.userTokens.failed++;
      }
    }

    console.log(`   Progress: ${Math.min(i + batchSize, usersWithTokens.length)}/${usersWithTokens.length}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 100;

  console.log('🔐 Key Rotation Script');
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
  }

  console.log(`Batch size: ${batchSize}`);

  // Get current encryption version
  const targetVersion = await getCurrentVersion();
  console.log(`\nTarget encryption version: ${targetVersion}`);

  // Rotate all encrypted data
  await rotateSecrets(targetVersion, dryRun, batchSize);
  await rotateProviderTokens(targetVersion, dryRun, batchSize);
  await rotateUserTokens(targetVersion, dryRun, batchSize);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Rotation Summary');
  console.log('='.repeat(50));
  console.log(`\nSecrets:`);
  console.log(`   Total: ${stats.secrets.total}`);
  console.log(`   Rotated: ${stats.secrets.rotated}`);
  console.log(`   Failed: ${stats.secrets.failed}`);

  console.log(`\nProvider Tokens:`);
  console.log(`   Total: ${stats.providerTokens.total}`);
  console.log(`   Rotated: ${stats.providerTokens.rotated}`);
  console.log(`   Failed: ${stats.providerTokens.failed}`);

  console.log(`\nUser Tokens:`);
  console.log(`   Total: ${stats.userTokens.total}`);
  console.log(`   Rotated: ${stats.userTokens.rotated}`);
  console.log(`   Failed: ${stats.userTokens.failed}`);

  const totalFailed = stats.secrets.failed + stats.providerTokens.failed + stats.userTokens.failed;
  if (totalFailed > 0) {
    console.log(`\n⚠️  ${totalFailed} items failed to rotate. Check logs above for details.`);
    process.exit(1);
  } else if (!dryRun) {
    console.log('\n✅ Key rotation completed successfully!');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
