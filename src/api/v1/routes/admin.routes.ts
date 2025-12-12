import { FastifyInstance } from 'fastify';
import { requireAdminSecret, requireAdmin } from '../../../middleware/admin';
import { rotateEncryptionKeys } from '../../../services/keyRotation';
import { db, users, vaults, secrets, activityLogs, syncLogs, vaultSyncs } from '../../../db';
import { count, desc, eq, gt } from 'drizzle-orm';
import { authenticateGitHub } from '../../../middleware/auth';
import { sendData, sendPaginatedData } from '../../../lib/response';
import { parsePagination, buildPaginationMeta } from '../../../lib/pagination';
import { InternalError } from '../../../lib/errors';

/**
 * Admin Routes
 * Protected by X-Admin-Secret header or admin user
 */
export async function adminRoutes(fastify: FastifyInstance) {
  /**
   * POST /admin/rotate-key
   * Rotate encryption keys to the current version
   *
   * Query params:
   * - dry_run=true: Preview what would be rotated without making changes
   * - batch_size=100: Number of records to process at a time
   */
  fastify.post<{
    Querystring: {
      dry_run?: string;
      batch_size?: string;
    };
  }>('/rotate-key', {
    preHandler: [requireAdminSecret],
  }, async (request, reply) => {
    const dryRun = request.query.dry_run === 'true';
    const batchSize = request.query.batch_size
      ? parseInt(request.query.batch_size, 10)
      : 100;

    request.log.info({ dryRun, batchSize }, 'Starting key rotation');

    const result = await rotateEncryptionKeys({ dryRun, batchSize });

    const totalFailed =
      result.secrets.failed +
      result.providerTokens.failed +
      result.userTokens.failed;

    if (totalFailed > 0) {
      request.log.warn({ result }, 'Key rotation completed with failures');
    } else {
      request.log.info({ result }, 'Key rotation completed successfully');
    }

    return sendData(reply, {
      success: totalFailed === 0,
      dryRun,
      ...result,
    }, { requestId: request.id });
  });

  // ============================================
  // Admin Dashboard Routes (read-only)
  // ============================================

  /**
   * GET /admin/stats
   * System health metrics
   */
  fastify.get('/stats', {
    preHandler: [authenticateGitHub, requireAdmin],
  }, async (request, reply) => {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [vaultCount] = await db.select({ count: count() }).from(vaults);
    const [secretCount] = await db.select({ count: count() }).from(secrets);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [syncCount] = await db
      .select({ count: count() })
      .from(syncLogs)
      .where(gt(syncLogs.createdAt, twentyFourHoursAgo));

    return sendData(reply, {
      totalUsers: Number(userCount.count),
      totalVaults: Number(vaultCount.count),
      totalSecrets: Number(secretCount.count),
      syncsLast24h: Number(syncCount.count),
    }, { requestId: request.id });
  });

  /**
   * GET /admin/users
   * List all users with vault counts
   */
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/users', {
    preHandler: [authenticateGitHub, requireAdmin],
  }, async (request, reply) => {
    const pagination = parsePagination(request.query);

    // Get total count
    const [totalResult] = await db.select({ count: count() }).from(users);
    const total = Number(totalResult.count);

    const userList = await db
      .select({
        id: users.id,
        email: users.email,
        githubUsername: users.username,
        avatarUrl: users.avatarUrl,
        plan: users.plan,
        billingStatus: users.billingStatus,
        createdAt: users.createdAt,
        lastSeenAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);

    // Get vault counts for each user
    const usersWithVaultCount = await Promise.all(
      userList.map(async (user) => {
        const [vaultCountResult] = await db
          .select({ count: count() })
          .from(vaults)
          .where(eq(vaults.ownerId, user.id));
        return {
          ...user,
          vaultCount: Number(vaultCountResult.count),
        };
      })
    );

    const meta = buildPaginationMeta(pagination, total, usersWithVaultCount.length);
    return sendPaginatedData(reply, usersWithVaultCount, meta, { requestId: request.id });
  });

  /**
   * GET /admin/vaults
   * List all vaults with details
   */
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/vaults', {
    preHandler: [authenticateGitHub, requireAdmin],
  }, async (request, reply) => {
    const pagination = parsePagination(request.query);

    // Get total count
    const [totalResult] = await db.select({ count: count() }).from(vaults);
    const total = Number(totalResult.count);

    const vaultList = await db
      .select({
        id: vaults.id,
        repoFullName: vaults.repoFullName,
        isPrivate: vaults.isPrivate,
        environments: vaults.environments,
        createdAt: vaults.createdAt,
        updatedAt: vaults.updatedAt,
      })
      .from(vaults)
      .orderBy(desc(vaults.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);

    // Get additional details for each vault
    const vaultsWithDetails = await Promise.all(
      vaultList.map(async (vault) => {
        // Secret count
        const [secretCountResult] = await db
          .select({ count: count() })
          .from(secrets)
          .where(eq(secrets.vaultId, vault.id));

        // Last sync
        const [lastSync] = await db
          .select({ createdAt: syncLogs.createdAt })
          .from(syncLogs)
          .where(eq(syncLogs.vaultId, vault.id))
          .orderBy(desc(syncLogs.createdAt))
          .limit(1);

        // Check for Vercel integration
        const [vercelSync] = await db
          .select({ id: vaultSyncs.id })
          .from(vaultSyncs)
          .where(eq(vaultSyncs.vaultId, vault.id))
          .limit(1);

        const [repoOwner, repoName] = vault.repoFullName.split('/');

        return {
          id: vault.id,
          repoOwner,
          repoName,
          isPrivate: vault.isPrivate,
          environmentCount: vault.environments?.length || 0,
          secretCount: Number(secretCountResult.count),
          lastSyncAt: lastSync?.createdAt || null,
          hasVercelIntegration: !!vercelSync,
          hasGithubApp: false, // Not implemented
          createdAt: vault.createdAt,
        };
      })
    );

    const meta = buildPaginationMeta(pagination, total, vaultsWithDetails.length);
    return sendPaginatedData(reply, vaultsWithDetails, meta, { requestId: request.id });
  });

  /**
   * GET /admin/events
   * List activity logs
   */
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/events', {
    preHandler: [authenticateGitHub, requireAdmin],
  }, async (request, reply) => {
    const pagination = parsePagination(request.query);

    // Get total count
    const [totalResult] = await db.select({ count: count() }).from(activityLogs);
    const total = Number(totalResult.count);

    const events = await db
      .select({
        id: activityLogs.id,
        timestamp: activityLogs.createdAt,
        action: activityLogs.action,
        platform: activityLogs.platform,
        userId: activityLogs.userId,
        vaultId: activityLogs.vaultId,
        metadata: activityLogs.metadata,
        ipAddress: activityLogs.ipAddress,
      })
      .from(activityLogs)
      .orderBy(desc(activityLogs.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);

    // Enrich with vault and user info
    const enrichedEvents = await Promise.all(
      events.map(async (event) => {
        let repo = null;
        let username = null;

        if (event.vaultId) {
          const [vault] = await db
            .select({ repoFullName: vaults.repoFullName })
            .from(vaults)
            .where(eq(vaults.id, event.vaultId))
            .limit(1);
          repo = vault?.repoFullName || null;
        }

        if (event.userId) {
          const [user] = await db
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, event.userId))
            .limit(1);
          username = user?.username || null;
        }

        return {
          id: event.id,
          timestamp: event.timestamp,
          action: event.action,
          platform: event.platform,
          userId: event.userId,
          username,
          repo,
          metadata: event.metadata ? (() => { try { return JSON.parse(event.metadata); } catch { return { raw: event.metadata }; } })() : null,
          ipAddress: event.ipAddress,
        };
      })
    );

    const meta = buildPaginationMeta(pagination, total, enrichedEvents.length);
    return sendPaginatedData(reply, enrichedEvents, meta, { requestId: request.id });
  });

  /**
   * GET /admin/sync-errors
   * List failed sync operations
   */
  fastify.get<{
    Querystring: { limit?: string };
  }>('/sync-errors', {
    preHandler: [authenticateGitHub, requireAdmin],
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit || '20', 10), 50);

    const errors = await db
      .select({
        id: syncLogs.id,
        timestamp: syncLogs.createdAt,
        vaultId: syncLogs.vaultId,
        provider: syncLogs.provider,
        direction: syncLogs.direction,
        error: syncLogs.error,
        secretsCreated: syncLogs.secretsCreated,
        secretsUpdated: syncLogs.secretsUpdated,
        secretsDeleted: syncLogs.secretsDeleted,
        secretsSkipped: syncLogs.secretsSkipped,
      })
      .from(syncLogs)
      .where(eq(syncLogs.status, 'failed'))
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit);

    // Enrich with vault info
    const enrichedErrors = await Promise.all(
      errors.map(async (error) => {
        let repo = null;
        if (error.vaultId) {
          const [vault] = await db
            .select({ repoFullName: vaults.repoFullName })
            .from(vaults)
            .where(eq(vaults.id, error.vaultId))
            .limit(1);
          repo = vault?.repoFullName || null;
        }

        return {
          id: error.id,
          timestamp: error.timestamp,
          repo,
          provider: error.provider,
          direction: error.direction,
          errorMessage: error.error,
          stats: {
            created: error.secretsCreated,
            updated: error.secretsUpdated,
            deleted: error.secretsDeleted,
            skipped: error.secretsSkipped,
          },
        };
      })
    );

    return sendData(reply, { errors: enrichedErrors }, { requestId: request.id });
  });

  /**
   * POST /admin/test-error
   * Test endpoint to verify Sentry error tracking
   * Throws a 500 error that should be captured by Sentry
   */
  fastify.post('/test-error', {
    preHandler: [requireAdminSecret],
  }, async (request) => {
    request.log.info('Triggering test error for Sentry verification');
    throw new InternalError('Test error for Sentry verification - this is intentional');
  });
}
