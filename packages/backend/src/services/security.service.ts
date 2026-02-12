import crypto from "crypto";
import { db, pullEvents, securityAlerts, users, vaults, secretAccesses, activityLogs } from "../db";
import { eq, and, desc, gte, isNotNull, count, inArray, sql } from "drizzle-orm";
import type { SecurityAlertType } from "../db/schema";
import { config } from "../config";
import { sendSecurityAlertEmail } from "../utils/email";
import { logger } from "../utils/sharedLogger";

// Types
export type PullSource = "cli" | "api_key" | "mcp";

export interface PullContext {
  userId: string;
  vaultId: string;
  deviceId: string;
  ip: string;
  userAgent: string | null;
  source?: PullSource;
}

interface GeoLocation {
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

// In-memory geo cache (simple Map with TTL)
const geoCache = new Map<string, { data: GeoLocation; expires: number }>();
const GEO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============ GEOLOCATION ============
async function getLocation(ip: string): Promise<GeoLocation> {
  // Skip private/local IPs
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return { country: null, city: null, latitude: null, longitude: null };
  }

  // Check cache
  const cached = geoCache.get(ip);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    let url = `https://ipinfo.io/${ip}/json`;
    if (config.security.ipinfoToken) {
      url += `?token=${config.security.ipinfoToken}`;
    }
    const res = await fetch(url);
    const data = (await res.json()) as { loc?: string; country?: string; city?: string };
    const [lat, lon] = (data.loc || "").split(",").map(Number);

    const location: GeoLocation = {
      country: data.country || null,
      city: data.city || null,
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lon) ? null : lon,
    };

    geoCache.set(ip, { data: location, expires: Date.now() + GEO_CACHE_TTL });
    return location;
  } catch {
    return { country: null, city: null, latitude: null, longitude: null };
  }
}

// ============ DETECTION CHECKS ============

// A. New Device
async function checkNewDevice(ctx: PullContext): Promise<string | null> {
  const existing = await db.query.pullEvents.findFirst({
    where: and(eq(pullEvents.vaultId, ctx.vaultId), eq(pullEvents.deviceId, ctx.deviceId)),
  });
  if (!existing) {
    return `New device detected: ${ctx.deviceId.slice(0, 8)}...`;
  }
  return null;
}

// B. New Location
async function checkNewLocation(ctx: PullContext, loc: GeoLocation): Promise<string | null> {
  if (!loc.country) {
    return null;
  }

  const existing = await db.query.pullEvents.findFirst({
    where: and(eq(pullEvents.vaultId, ctx.vaultId), eq(pullEvents.country, loc.country)),
  });
  if (!existing) {
    return `Pull from new location: ${loc.city || loc.country}`;
  }
  return null;
}

// C. Impossible Travel
async function checkImpossibleTravel(ctx: PullContext, loc: GeoLocation): Promise<string | null> {
  if (!loc.latitude || !loc.longitude) {
    return null;
  }

  const lastPull = await db.query.pullEvents.findFirst({
    where: and(
      eq(pullEvents.vaultId, ctx.vaultId),
      eq(pullEvents.deviceId, ctx.deviceId),
      isNotNull(pullEvents.latitude)
    ),
    orderBy: [desc(pullEvents.createdAt)],
  });

  if (!lastPull?.latitude || !lastPull?.longitude) {
    return null;
  }

  const distanceKm = haversine(
    Number(lastPull.latitude),
    Number(lastPull.longitude),
    loc.latitude,
    loc.longitude
  );
  const timeDiffMin = (Date.now() - lastPull.createdAt.getTime()) / 60000;

  // >2000km in <30min is suspicious
  if (distanceKm > 2000 && timeDiffMin < 30) {
    return `Impossible travel: ${Math.round(distanceKm)}km in ${Math.round(timeDiffMin)} minutes`;
  }
  return null;
}

// D. Weird User Agent
function checkWeirdUserAgent(ctx: PullContext): string | null {
  const ua = ctx.userAgent || "";
  if (!ua.toLowerCase().startsWith("keyway-cli/")) {
    return `Suspicious user-agent: ${ua.slice(0, 50) || "(empty)"}`;
  }
  return null;
}

// E. Rate Anomaly
async function checkRateAnomaly(ctx: PullContext): Promise<string | null> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const recentPulls = await db
    .select({ count: count() })
    .from(pullEvents)
    .where(and(eq(pullEvents.vaultId, ctx.vaultId), gte(pullEvents.createdAt, fiveMinAgo)));

  const pullCount = recentPulls[0]?.count ?? 0;
  if (pullCount > 20) {
    return `High pull frequency: ${pullCount} pulls in 5 minutes`;
  }
  return null;
}

// ============ DEDUPLICATION ============
async function isDuplicate(
  vaultId: string,
  deviceId: string,
  alertType: SecurityAlertType
): Promise<boolean> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const existing = await db.query.securityAlerts.findFirst({
    where: and(
      eq(securityAlerts.vaultId, vaultId),
      eq(securityAlerts.deviceId, deviceId),
      eq(securityAlerts.alertType, alertType),
      gte(securityAlerts.createdAt, dayAgo)
    ),
  });
  return !!existing;
}

// ============ MAIN PIPELINE ============
export async function processPullEvent(ctx: PullContext): Promise<void> {
  // 1. Get geolocation
  const location = await getLocation(ctx.ip);

  // 2. Log pull event
  const source = ctx.source || "cli";
  const [pullEvent] = await db
    .insert(pullEvents)
    .values({
      userId: ctx.userId,
      vaultId: ctx.vaultId,
      deviceId: ctx.deviceId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      country: location.country,
      city: location.city,
      latitude: location.latitude?.toString(),
      longitude: location.longitude?.toString(),
      source,
    })
    .returning();

  // 3. Skip security checks for non-CLI sources (API keys, MCP)
  if (source !== "cli") {
    return;
  }

  // 4. Run detection checks
  const checks: Array<{
    type: SecurityAlertType;
    check: () => Promise<string | null> | string | null;
  }> = [
    { type: "new_device", check: () => checkNewDevice(ctx) },
    { type: "new_location", check: () => checkNewLocation(ctx, location) },
    { type: "impossible_travel", check: () => checkImpossibleTravel(ctx, location) },
    { type: "weird_user_agent", check: () => checkWeirdUserAgent(ctx) },
    { type: "rate_anomaly", check: () => checkRateAnomaly(ctx) },
  ];

  // 5. Create alerts (with dedup) and send email notifications
  for (const { type, check } of checks) {
    const message = await check();
    if (message && !(await isDuplicate(ctx.vaultId, ctx.deviceId, type))) {
      await db.insert(securityAlerts).values({
        userId: ctx.userId,
        vaultId: ctx.vaultId,
        deviceId: ctx.deviceId,
        alertType: type,
        message,
        details: { ip: ctx.ip, userAgent: ctx.userAgent, location },
        pullEventId: pullEvent.id,
      });

      // Send email notification (fire-and-forget)
      notifyUserOfAlert(ctx.userId, ctx.vaultId, type, message, ctx.ip, location).catch((err) =>
        logger.error({ err, userId: ctx.userId, alertType: type }, "notifyUserOfAlert failed")
      );
    }
  }
}

// Helper to send security alert email notification
async function notifyUserOfAlert(
  userId: string,
  vaultId: string,
  alertType: SecurityAlertType,
  message: string,
  ip: string,
  location: { country: string | null; city: string | null }
): Promise<void> {
  try {
    const [user, vault] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, username: true },
      }),
      db.query.vaults.findFirst({
        where: eq(vaults.id, vaultId),
        columns: { repoFullName: true },
      }),
    ]);

    if (user?.email) {
      await sendSecurityAlertEmail({
        to: user.email,
        username: user.username,
        alertType,
        message,
        vaultName: vault?.repoFullName || "Unknown vault",
        ip,
        location,
      });
    }
  } catch (err) {
    logger.error({ err, userId, vaultId, alertType }, "Failed to send security alert notification");
  }
}

// ============ DASHBOARD QUERIES ============
export async function getSecurityAlerts(vaultId: string, limit = 50, offset = 0) {
  return db.query.securityAlerts.findMany({
    where: eq(securityAlerts.vaultId, vaultId),
    orderBy: [desc(securityAlerts.createdAt)],
    limit,
    offset,
    with: {
      pullEvent: true,
    },
  });
}

// ============ SECURITY CENTER OVERVIEW ============

export interface SecurityOverviewResponse {
  alerts: {
    total: number;
    critical: number;
    warning: number;
    last7Days: number;
    last30Days: number;
  };
  access: {
    uniqueUsers: number;
    totalPulls: number;
    last7Days: number;
    topVaults: Array<{ repoFullName: string; pullCount: number }>;
    topUsers: Array<{ username: string; avatarUrl: string | null; pullCount: number }>;
  };
  exposure: {
    usersWithAccess: number;
    secretsAccessed: number;
    lastAccessAt: string | null;
  };
}

const _CRITICAL_ALERT_TYPES: SecurityAlertType[] = [
  "impossible_travel",
  "weird_user_agent",
  "rate_anomaly",
];

export async function getSecurityOverview(userId: string): Promise<SecurityOverviewResponse> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get all vaults owned by user
  const userVaults = await db.query.vaults.findMany({
    where: eq(vaults.ownerId, userId),
    columns: { id: true, repoFullName: true },
  });
  const vaultIds = userVaults.map((v) => v.id);

  if (vaultIds.length === 0) {
    return {
      alerts: { total: 0, critical: 0, warning: 0, last7Days: 0, last30Days: 0 },
      access: { uniqueUsers: 0, totalPulls: 0, last7Days: 0, topVaults: [], topUsers: [] },
      exposure: { usersWithAccess: 0, secretsAccessed: 0, lastAccessAt: null },
    };
  }

  // === ALERTS STATS ===
  const alertStats = await db
    .select({
      total: count(),
      critical: count(
        sql`CASE WHEN ${securityAlerts.alertType} IN ('impossible_travel', 'weird_user_agent', 'rate_anomaly') THEN 1 END`
      ),
      warning: count(
        sql`CASE WHEN ${securityAlerts.alertType} IN ('new_device', 'new_location') THEN 1 END`
      ),
      last7Days: count(
        sql`CASE WHEN ${securityAlerts.createdAt} >= ${sevenDaysAgo.toISOString()} THEN 1 END`
      ),
      last30Days: count(
        sql`CASE WHEN ${securityAlerts.createdAt} >= ${thirtyDaysAgo.toISOString()} THEN 1 END`
      ),
    })
    .from(securityAlerts)
    .where(inArray(securityAlerts.vaultId, vaultIds));

  // === ACCESS STATS (from pullEvents) ===
  const accessStats = await db
    .select({
      uniqueUsers: sql<number>`COUNT(DISTINCT ${pullEvents.userId})`,
      totalPulls: count(),
      last7Days: count(
        sql`CASE WHEN ${pullEvents.createdAt} >= ${sevenDaysAgo.toISOString()} THEN 1 END`
      ),
    })
    .from(pullEvents)
    .where(inArray(pullEvents.vaultId, vaultIds));

  // Top 5 vaults by pull count
  const topVaultsResult = await db
    .select({
      vaultId: pullEvents.vaultId,
      pullCount: count(),
    })
    .from(pullEvents)
    .where(inArray(pullEvents.vaultId, vaultIds))
    .groupBy(pullEvents.vaultId)
    .orderBy(desc(count()))
    .limit(5);

  const vaultIdToName = new Map(userVaults.map((v) => [v.id, v.repoFullName]));
  const topVaults = topVaultsResult.map((r) => ({
    repoFullName: vaultIdToName.get(r.vaultId!) || "Unknown",
    pullCount: Number(r.pullCount),
  }));

  // Top 5 users by pull count
  const topUsersResult = await db
    .select({
      userId: pullEvents.userId,
      pullCount: count(),
    })
    .from(pullEvents)
    .where(and(inArray(pullEvents.vaultId, vaultIds), isNotNull(pullEvents.userId)))
    .groupBy(pullEvents.userId)
    .orderBy(desc(count()))
    .limit(5);

  // Fetch user info for top users
  const topUserIds = topUsersResult.map((r) => r.userId).filter((id): id is string => id !== null);
  const topUsersInfo =
    topUserIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.id, topUserIds),
          columns: { id: true, username: true, avatarUrl: true },
        })
      : [];
  const userIdToInfo = new Map(
    topUsersInfo.map((u) => [u.id, { username: u.username, avatarUrl: u.avatarUrl }])
  );

  const topUsers = topUsersResult.map((r) => ({
    username: userIdToInfo.get(r.userId!)?.username || "Unknown",
    avatarUrl: userIdToInfo.get(r.userId!)?.avatarUrl || null,
    pullCount: Number(r.pullCount),
  }));

  // === EXPOSURE STATS (from secretAccesses) ===
  const exposureStats = await db
    .select({
      usersWithAccess: sql<number>`COUNT(DISTINCT ${secretAccesses.userId})`,
      secretsAccessed: sql<number>`COUNT(DISTINCT ${secretAccesses.secretId})`,
      lastAccessAt: sql<string | null>`MAX(${secretAccesses.lastAccessedAt})`,
    })
    .from(secretAccesses)
    .where(inArray(secretAccesses.vaultId, vaultIds));

  // lastAccessAt comes as string from SQL
  const lastAccessAtRaw = exposureStats[0]?.lastAccessAt;
  const lastAccessAt = lastAccessAtRaw
    ? typeof lastAccessAtRaw === "string"
      ? lastAccessAtRaw
      : new Date(lastAccessAtRaw).toISOString()
    : null;

  return {
    alerts: {
      total: Number(alertStats[0]?.total ?? 0),
      critical: Number(alertStats[0]?.critical ?? 0),
      warning: Number(alertStats[0]?.warning ?? 0),
      last7Days: Number(alertStats[0]?.last7Days ?? 0),
      last30Days: Number(alertStats[0]?.last30Days ?? 0),
    },
    access: {
      uniqueUsers: Number(accessStats[0]?.uniqueUsers ?? 0),
      totalPulls: Number(accessStats[0]?.totalPulls ?? 0),
      last7Days: Number(accessStats[0]?.last7Days ?? 0),
      topVaults,
      topUsers,
    },
    exposure: {
      usersWithAccess: Number(exposureStats[0]?.usersWithAccess ?? 0),
      secretsAccessed: Number(exposureStats[0]?.secretsAccessed ?? 0),
      lastAccessAt,
    },
  };
}

// ============ ACCESS LOG ============

export type AccessLogAction = "pull" | "view" | "view_version";

export interface AccessLogEvent {
  id: string;
  timestamp: string;
  action: AccessLogAction;
  user: { username: string; avatarUrl: string | null } | null;
  vault: { repoFullName: string } | null;
  ip: string;
  location: { country: string | null; city: string | null };
  deviceId: string;
  hasAlert: boolean;
  source?: PullSource;
  metadata?: {
    secretKey?: string;
    environment?: string;
    platform?: string;
  };
}

export interface AccessLogResponse {
  events: AccessLogEvent[];
  total: number;
}

export async function getAccessLog(
  userId: string,
  options?: { limit?: number; offset?: number; vaultId?: string }
): Promise<AccessLogResponse> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  // Get all vaults owned by user
  const userVaults = await db.query.vaults.findMany({
    where: eq(vaults.ownerId, userId),
    columns: { id: true, repoFullName: true },
  });
  const vaultIds = userVaults.map((v) => v.id);

  if (vaultIds.length === 0) {
    return { events: [], total: 0 };
  }

  // Filter by specific vault if provided
  const targetVaultIds = options?.vaultId
    ? vaultIds.filter((id) => id === options.vaultId)
    : vaultIds;

  if (targetVaultIds.length === 0) {
    return { events: [], total: 0 };
  }

  // Get total count for pull events
  const [pullCountResult] = await db
    .select({ count: count() })
    .from(pullEvents)
    .where(inArray(pullEvents.vaultId, targetVaultIds));

  // Get total count for view events (secret_value_accessed, secret_version_value_accessed)
  const [viewCountResult] = await db
    .select({ count: count() })
    .from(activityLogs)
    .where(
      and(
        inArray(activityLogs.vaultId, targetVaultIds),
        inArray(activityLogs.action, ["secret_value_accessed", "secret_version_value_accessed"])
      )
    );

  const totalCount = (pullCountResult?.count ?? 0) + (viewCountResult?.count ?? 0);

  // Get pull events with related data
  const pullEventsData = await db.query.pullEvents.findMany({
    where: inArray(pullEvents.vaultId, targetVaultIds),
    orderBy: [desc(pullEvents.createdAt)],
    limit: limit * 2, // Get more to allow for merged sorting
    with: {
      user: {
        columns: { username: true, avatarUrl: true },
      },
      vault: {
        columns: { repoFullName: true },
      },
      securityAlerts: {
        columns: { id: true },
        limit: 1,
      },
    },
  });

  // Get view events from activity logs
  const viewEventsData = await db.query.activityLogs.findMany({
    where: and(
      inArray(activityLogs.vaultId, targetVaultIds),
      inArray(activityLogs.action, ["secret_value_accessed", "secret_version_value_accessed"])
    ),
    orderBy: [desc(activityLogs.createdAt)],
    limit: limit * 2, // Get more to allow for merged sorting
    with: {
      user: {
        columns: { username: true, avatarUrl: true },
      },
      vault: {
        columns: { repoFullName: true },
      },
    },
  });

  // Map pull events
  const mappedPullEvents: AccessLogEvent[] = pullEventsData.map((e) => ({
    id: e.id,
    timestamp: e.createdAt.toISOString(),
    action: "pull" as AccessLogAction,
    user: e.user ? { username: e.user.username, avatarUrl: e.user.avatarUrl } : null,
    vault: e.vault ? { repoFullName: e.vault.repoFullName } : null,
    ip: e.ip,
    location: { country: e.country, city: e.city },
    deviceId: e.deviceId,
    hasAlert: e.securityAlerts && e.securityAlerts.length > 0,
    source: e.source as PullSource,
  }));

  // Map view events
  const mappedViewEvents: AccessLogEvent[] = viewEventsData.map((e) => {
    const metadata = e.metadata ? JSON.parse(e.metadata) : {};
    return {
      id: e.id,
      timestamp: e.createdAt.toISOString(),
      action: (e.action === "secret_version_value_accessed"
        ? "view_version"
        : "view") as AccessLogAction,
      user: e.user ? { username: e.user.username, avatarUrl: e.user.avatarUrl } : null,
      vault: e.vault ? { repoFullName: e.vault.repoFullName } : null,
      ip: e.ipAddress || "unknown",
      location: { country: null, city: null }, // Activity logs don't have geo data
      deviceId: "", // Activity logs don't have device ID
      hasAlert: false, // No security alerts for view events
      metadata: {
        secretKey: metadata.key,
        environment: metadata.environment,
        platform: e.platform,
      },
    };
  });

  // Combine and sort by timestamp descending
  const allEvents = [...mappedPullEvents, ...mappedViewEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(offset, offset + limit);

  return {
    events: allEvents,
    total: totalCount,
  };
}

export async function getSecurityAlertsForUser(userId: string, limit = 50, offset = 0) {
  return db.query.securityAlerts.findMany({
    where: eq(securityAlerts.userId, userId),
    orderBy: [desc(securityAlerts.createdAt)],
    limit,
    offset,
    with: {
      vault: {
        columns: { repoFullName: true },
      },
      pullEvent: true,
    },
  });
}

// ============ HELPERS ============
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function generateDeviceId(userAgent: string | null, ip: string): string {
  const data = `${userAgent || "unknown"}|${ip}`;
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 32);
}
