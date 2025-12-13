import crypto from 'crypto';

/**
 * API Key utilities for Keyway
 *
 * Token format: kw_{environment}_{random}
 * - Prefix: kw_
 * - Environment: live | test
 * - Random: 40 characters base62 (240 bits entropy)
 *
 * Example: kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const RANDOM_LENGTH = 40;
const PREFIX_DISPLAY_LENGTH = 8; // How much of the random part to show in prefix

// Available scopes for API keys
export const API_KEY_SCOPES = [
  'read:secrets',
  'write:secrets',
  'delete:secrets',
  'admin:api-keys',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type ApiKeyEnvironment = 'live' | 'test';

export interface GeneratedApiKey {
  /** The full token (shown ONCE at creation, never stored) */
  token: string;
  /** Display prefix for UI: "kw_live_a1B2c3D4" */
  prefix: string;
  /** SHA-256 hash for database storage */
  hash: string;
}

/**
 * Generate a new API key
 *
 * @param environment - 'live' for production, 'test' for development
 * @returns Generated key with token, prefix, and hash
 */
export function generateApiKey(environment: ApiKeyEnvironment): GeneratedApiKey {
  // Generate cryptographically secure random bytes
  // We need RANDOM_LENGTH (40) bytes since each byte becomes one base62 character
  const bytes = crypto.randomBytes(RANDOM_LENGTH);

  // Convert to base62
  let random = '';
  for (const byte of bytes) {
    random += BASE62[byte % 62];
  }
  random = random.slice(0, RANDOM_LENGTH);

  // Build the full token
  const token = `kw_${environment}_${random}`;

  // Create display prefix (for showing in UI after creation)
  const prefix = `kw_${environment}_${random.slice(0, PREFIX_DISPLAY_LENGTH)}`;

  // Hash for storage (never store the token itself)
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  return { token, prefix, hash };
}

/**
 * Hash an API key for database lookup
 *
 * @param token - The full API key token
 * @returns SHA-256 hash
 */
export function hashApiKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Validate API key format
 *
 * @param token - The token to validate
 * @returns true if format is valid
 */
export function validateApiKeyFormat(token: string): boolean {
  // Format: kw_{live|test}_{40 chars base62}
  return /^kw_(live|test)_[a-zA-Z0-9]{40}$/.test(token);
}

/**
 * Extract environment from API key
 *
 * @param token - The API key token
 * @returns 'live' | 'test' | null if invalid
 */
export function extractEnvironment(token: string): ApiKeyEnvironment | null {
  const match = token.match(/^kw_(live|test)_/);
  return match ? (match[1] as ApiKeyEnvironment) : null;
}

/**
 * Check if a token looks like a Keyway API key
 * (Quick check before full validation)
 *
 * @param token - The token to check
 * @returns true if it starts with 'kw_'
 */
export function isKeywayApiKey(token: string): boolean {
  return token.startsWith('kw_');
}

/**
 * Validate that scopes are valid
 *
 * @param scopes - Array of scope strings to validate
 * @returns true if all scopes are valid
 */
export function validateScopes(scopes: string[]): scopes is ApiKeyScope[] {
  return scopes.every((scope) => (API_KEY_SCOPES as readonly string[]).includes(scope));
}

/**
 * Check if a set of scopes includes all required scopes
 *
 * @param userScopes - Scopes the API key has
 * @param requiredScopes - Scopes required for the operation
 * @returns true if all required scopes are present
 */
export function hasRequiredScopes(userScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => userScopes.includes(scope));
}

/**
 * Mask an API key for logging (show only prefix)
 *
 * @param token - The full token
 * @returns Masked version like "kw_live_a1B2****"
 */
export function maskApiKey(token: string): string {
  if (!validateApiKeyFormat(token)) {
    return '***invalid***';
  }
  // Show prefix + first 4 chars of random, mask the rest
  const parts = token.split('_');
  if (parts.length !== 3) return '***invalid***';
  return `kw_${parts[1]}_${parts[2].slice(0, 4)}${'*'.repeat(36)}`;
}
