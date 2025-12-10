import { db, activityLogs } from '../db';
import { eq, desc, count } from 'drizzle-orm';
import type { ActivityAction, ActivityPlatform } from '../db/schema';
import type { PaginationQuery } from '../lib/pagination';

export interface ActivityLogItem {
  id: string;
  action: ActivityAction;
  vaultId: string | null;
  repoFullName: string | null;
  actor: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
  platform: ActivityPlatform;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface LogActivityInput {
  userId: string;
  action: ActivityAction;
  platform: ActivityPlatform;
  vaultId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Log an activity event
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  await db.insert(activityLogs).values({
    userId: input.userId,
    vaultId: input.vaultId || null,
    action: input.action,
    platform: input.platform,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
  });
}

/**
 * Get activity logs for a user with pagination
 */
export async function getActivityForUser(
  userId: string,
  pagination: PaginationQuery
): Promise<{ activities: ActivityLogItem[]; total: number }> {
  // Get total count
  const [countResult] = await db
    .select({ count: count() })
    .from(activityLogs)
    .where(eq(activityLogs.userId, userId));
  const total = countResult?.count ?? 0;

  // Get paginated logs
  const logs = await db.query.activityLogs.findMany({
    where: eq(activityLogs.userId, userId),
    with: {
      user: true,
      vault: true,
    },
    orderBy: [desc(activityLogs.createdAt)],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  const activities: ActivityLogItem[] = logs.map((log) => {
    const metadata = log.metadata ? JSON.parse(log.metadata) : null;
    return {
      id: log.id,
      action: log.action,
      vaultId: log.vaultId,
      repoFullName: log.vault?.repoFullName || metadata?.repoFullName || null,
      actor: log.user ? {
        id: log.user.id,
        username: log.user.username,
        avatarUrl: log.user.avatarUrl,
      } : {
        id: log.userId || 'deleted',
        username: metadata?.username || 'Deleted User',
        avatarUrl: null,
      },
      platform: log.platform,
      metadata,
      timestamp: log.createdAt.toISOString(),
    };
  });

  return { activities, total };
}

/**
 * Helper to extract request info for logging
 */
export function extractRequestInfo(request: {
  ip?: string;
  headers?: { 'user-agent'?: string };
}): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: request?.ip || null,
    userAgent: request?.headers?.['user-agent'] || null,
  };
}

/**
 * Detect platform from request User-Agent or user agent string
 * - CLI: User-Agent contains "keyway-cli"
 * - Web: User-Agent is a browser (contains Mozilla, Chrome, Safari, etc.)
 * - API: Everything else (curl, scripts, etc.)
 */
export function detectPlatform(userAgentOrRequest: string | null | undefined | {
  headers?: { 'user-agent'?: string };
}): ActivityPlatform {
  let userAgent: string;

  if (typeof userAgentOrRequest === 'string') {
    userAgent = userAgentOrRequest;
  } else if (userAgentOrRequest && typeof userAgentOrRequest === 'object') {
    userAgent = userAgentOrRequest?.headers?.['user-agent'] || '';
  } else {
    userAgent = '';
  }

  if (userAgent.toLowerCase().includes('keyway-cli')) {
    return 'cli';
  }

  // Common browser identifiers
  if (userAgent.includes('Mozilla') || userAgent.includes('Chrome') ||
      userAgent.includes('Safari') || userAgent.includes('Firefox') ||
      userAgent.includes('Edge')) {
    return 'web';
  }

  return 'api';
}
