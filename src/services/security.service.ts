import crypto from 'crypto';
import { db, pullEvents, securityAlerts, users, vaults } from '../db';
import { eq, and, desc, gte, isNotNull, count } from 'drizzle-orm';
import type { SecurityAlertType } from '../db/schema';
import { config } from '../config';
import { sendSecurityAlertEmail } from '../utils/email';
import { logger } from '../utils/sharedLogger';

// Types
export interface PullContext {
  userId: string;
  vaultId: string;
  deviceId: string;
  ip: string;
  userAgent: string | null;
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
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { country: null, city: null, latitude: null, longitude: null };
  }

  // Check cache
  const cached = geoCache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    let url = `https://ipinfo.io/${ip}/json`;
    if (config.security.ipinfoToken) {
      url += `?token=${config.security.ipinfoToken}`;
    }
    const res = await fetch(url);
    const data = await res.json() as { loc?: string; country?: string; city?: string };
    const [lat, lon] = (data.loc || '').split(',').map(Number);

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
    where: and(
      eq(pullEvents.vaultId, ctx.vaultId),
      eq(pullEvents.deviceId, ctx.deviceId)
    ),
  });
  if (!existing) {
    return `New device detected: ${ctx.deviceId.slice(0, 8)}...`;
  }
  return null;
}

// B. New Location
async function checkNewLocation(ctx: PullContext, loc: GeoLocation): Promise<string | null> {
  if (!loc.country) return null;

  const existing = await db.query.pullEvents.findFirst({
    where: and(
      eq(pullEvents.vaultId, ctx.vaultId),
      eq(pullEvents.country, loc.country)
    ),
  });
  if (!existing) {
    return `Pull from new location: ${loc.city || loc.country}`;
  }
  return null;
}

// C. Impossible Travel
async function checkImpossibleTravel(ctx: PullContext, loc: GeoLocation): Promise<string | null> {
  if (!loc.latitude || !loc.longitude) return null;

  const lastPull = await db.query.pullEvents.findFirst({
    where: and(
      eq(pullEvents.vaultId, ctx.vaultId),
      eq(pullEvents.deviceId, ctx.deviceId),
      isNotNull(pullEvents.latitude)
    ),
    orderBy: [desc(pullEvents.createdAt)],
  });

  if (!lastPull?.latitude || !lastPull?.longitude) return null;

  const distanceKm = haversine(
    Number(lastPull.latitude), Number(lastPull.longitude),
    loc.latitude, loc.longitude
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
  const ua = ctx.userAgent || '';
  if (!ua.toLowerCase().startsWith('keyway-cli/')) {
    return `Suspicious user-agent: ${ua.slice(0, 50) || '(empty)'}`;
  }
  return null;
}

// E. Rate Anomaly
async function checkRateAnomaly(ctx: PullContext): Promise<string | null> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const recentPulls = await db.select({ count: count() })
    .from(pullEvents)
    .where(and(
      eq(pullEvents.vaultId, ctx.vaultId),
      gte(pullEvents.createdAt, fiveMinAgo)
    ));

  const pullCount = recentPulls[0]?.count ?? 0;
  if (pullCount > 20) {
    return `High pull frequency: ${pullCount} pulls in 5 minutes`;
  }
  return null;
}

// ============ DEDUPLICATION ============
async function isDuplicate(vaultId: string, deviceId: string, alertType: SecurityAlertType): Promise<boolean> {
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
  const [pullEvent] = await db.insert(pullEvents).values({
    userId: ctx.userId,
    vaultId: ctx.vaultId,
    deviceId: ctx.deviceId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    country: location.country,
    city: location.city,
    latitude: location.latitude?.toString(),
    longitude: location.longitude?.toString(),
  }).returning();

  // 3. Run detection checks
  const checks: Array<{ type: SecurityAlertType; check: () => Promise<string | null> | string | null }> = [
    { type: 'new_device', check: () => checkNewDevice(ctx) },
    { type: 'new_location', check: () => checkNewLocation(ctx, location) },
    { type: 'impossible_travel', check: () => checkImpossibleTravel(ctx, location) },
    { type: 'weird_user_agent', check: () => checkWeirdUserAgent(ctx) },
    { type: 'rate_anomaly', check: () => checkRateAnomaly(ctx) },
  ];

  // 4. Create alerts (with dedup) and send email notifications
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
      notifyUserOfAlert(ctx.userId, ctx.vaultId, type, message, ctx.ip, location)
        .catch(err => logger.error({ err, userId: ctx.userId, alertType: type }, 'notifyUserOfAlert failed'));
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
        vaultName: vault?.repoFullName || 'Unknown vault',
        ip,
        location,
      });
    }
  } catch (err) {
    logger.error({ err, userId, vaultId, alertType }, 'Failed to send security alert notification');
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
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function generateDeviceId(userAgent: string | null, ip: string): string {
  const data = `${userAgent || 'unknown'}|${ip}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}
