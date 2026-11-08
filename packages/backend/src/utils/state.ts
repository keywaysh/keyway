import crypto from "crypto";
import { config } from "../config";

/**
 * Sign a state object using HMAC-SHA256
 * Returns format: base64url(payload).base64url(signature)
 * State expires after 10 minutes by default
 */
export function signState(data: Record<string, unknown>, expiresInMs = 10 * 60 * 1000): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...data,
      exp: Date.now() + expiresInMs,
    })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.jwt.secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verify and decode a signed state
 * Returns null if signature is invalid or state has expired
 */
export function verifyState(signed: string): Record<string, unknown> | null {
  try {
    const parts = signed.split(".");
    if (parts.length !== 2) {
      return null;
    }

    const [payload, signature] = parts;
    if (!payload || !signature) {
      return null;
    }

    const expectedSig = crypto
      .createHmac("sha256", config.jwt.secret)
      .update(payload)
      .digest("base64url");

    // Use timing-safe comparison to prevent timing attacks
    if (
      signature.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
    ) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString());

    // Check expiration
    if (data.exp && typeof data.exp === "number" && data.exp < Date.now()) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Binding an OAuth state to the browser that started the flow.
 *
 * The route that redirects to the provider puts a random nonce in a short-lived httpOnly
 * cookie and the hash of that nonce in the signed state (`nonceHash`). The callback accepts
 * the state only from the browser holding the nonce, so a state (or a provider URL carrying
 * it) sent to someone else is useless: no login CSRF, no approving someone else's flow.
 */
export const STATE_NONCE_MAX_AGE_SECONDS = 10 * 60; // signState's default lifetime

export function hashStateNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("base64url");
}

export function createStateNonce(): { nonce: string; nonceHash: string } {
  const nonce = crypto.randomBytes(32).toString("base64url");
  return { nonce, nonceHash: hashStateNonce(nonce) };
}

/**
 * Single-use signed tickets: a short-lived signed value (signState format) that can be
 * redeemed once, used to hand a browser a link that starts a flow as a user without
 * putting that user's API token in the URL.
 *
 * Single use is enforced in memory, per process: with several API instances a ticket
 * could be redeemed once per instance within its lifetime. Tickets are therefore kept
 * short (callers pass the TTL, 60 s for provider authorization).
 */
const redeemedTickets = new Map<string, number>(); // ticket id -> expiry (ms)

export function signTicket(data: Record<string, unknown>, ttlMs: number): string {
  return signState({ ...data, jti: crypto.randomBytes(16).toString("base64url") }, ttlMs);
}

/**
 * Verifies a ticket of the given type WITHOUT burning it; null if invalid, expired or
 * already used. For checks that must pass before the ticket is spent (redeemTicket).
 */
export function peekTicket(ticket: string, type: string): Record<string, unknown> | null {
  const data = verifyState(ticket);
  if (!data || data.type !== type || typeof data.jti !== "string" || typeof data.exp !== "number") {
    return null;
  }

  const now = Date.now();
  for (const [id, expiresAt] of redeemedTickets) {
    if (expiresAt < now) {
      redeemedTickets.delete(id);
    }
  }
  return redeemedTickets.has(data.jti) ? null : data;
}

/** Verifies a ticket of the given type and burns it; null if invalid, expired or already used. */
export function redeemTicket(ticket: string, type: string): Record<string, unknown> | null {
  const data = peekTicket(ticket, type);
  if (!data) {
    return null;
  }
  redeemedTickets.set(data.jti as string, data.exp as number);
  return data;
}

/** True when `cookieNonce` is the nonce whose hash the verified state carries. */
export function stateNonceMatches(
  stateData: Record<string, unknown>,
  cookieNonce: string | undefined
): boolean {
  const expected = stateData.nonceHash;
  if (
    typeof expected !== "string" ||
    !expected ||
    typeof cookieNonce !== "string" ||
    !cookieNonce
  ) {
    return false;
  }
  const actual = Buffer.from(hashStateNonce(cookieNonce));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}
