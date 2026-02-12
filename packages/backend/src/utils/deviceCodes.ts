import crypto from "crypto";

/**
 * Generate a secure random device code (opaque, for polling)
 * Format: 64 character hex string (32 bytes = 256 bits of entropy)
 *
 * Security: Uses crypto.randomBytes(32) for cryptographically secure randomness.
 * This provides 256 bits of entropy, making brute-force attacks infeasible.
 * (HIGH-12: Device code entropy requirement met)
 */
export function generateDeviceCode(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a user-friendly code for display
 * Format: 10 character alphanumeric (uppercase, no confusing characters)
 *
 * Security: Generates 10 characters from a 29-character alphabet (excluding 0, O, 1, I, L).
 * This provides ~4.2 × 10^14 combinations (29^10 ≈ 48.5 bits of entropy), making brute-force
 * attacks infeasible during the 15-minute expiration window even with aggressive rate limiting bypass.
 * Uses crypto.randomBytes() for cryptographically secure randomness.
 * (CRIT-1 fix: Increased from 8 to 10 chars, using randomBytes)
 */
export function generateUserCode(): string {
  // Use only uppercase letters and numbers, excluding confusing characters (0, O, 1, I, L)
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const length = 10; // 10 characters for ~48 bits of entropy

  let code = "";
  const randomValues = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    // Use modulo to map random byte to character index
    // Note: slight bias exists (256 % 29 = 24), but negligible for security purposes
    const randomIndex = randomValues[i] % chars.length;
    code += chars[randomIndex];
  }

  // Format as XXXXX-XXXXX for readability
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Device flow configuration constants
 */
export const DEVICE_FLOW_CONFIG = {
  EXPIRES_IN: 900, // 15 minutes in seconds
  POLL_INTERVAL: 5, // 5 seconds between polls
} as const;
