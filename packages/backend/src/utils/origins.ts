/**
 * Check whether a redirect URL's origin belongs to the allowlist.
 *
 * Allowlist entries are normalized through URL.origin so a trailing slash,
 * an explicit default port or a different case in configuration
 * (ALLOWED_ORIGINS / FRONTEND_URL / DASHBOARD_URL) doesn't silently reject
 * every legitimate redirect — the guard fails closed, so a raw string
 * comparison would take billing down on a cosmetic config difference.
 *
 * The url argument is expected to be a valid URL (validated upstream).
 */
export function isAllowedOrigin(url: string, allowedOrigins: string[]): boolean {
  const origin = new URL(url).origin;
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === origin;
    } catch {
      // Not a parseable URL (e.g. a bare origin with a typo): compare as-is
      return allowed === origin;
    }
  });
}
