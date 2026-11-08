/**
 * Logger utilities for sanitizing sensitive data from logs
 */

/**
 * Mask a token by showing only the last 4 characters
 * @param token - The token to mask
 * @returns Masked token string (e.g., "***abc123")
 */
export function maskToken(token: string | undefined | null): string {
  if (!token) {
    return "[none]";
  }
  if (token.length <= 4) {
    return "***";
  }
  return `***${token.slice(-4)}`;
}

/**
 * Sanitize request headers to remove sensitive tokens
 * @param headers - Request headers object
 * @returns Sanitized headers object
 */
export function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const sanitized = { ...headers };

  // Mask Authorization header
  if (sanitized.authorization) {
    if (
      typeof sanitized.authorization === "string" &&
      sanitized.authorization.startsWith("Bearer ")
    ) {
      const token = sanitized.authorization.substring(7);
      sanitized.authorization = `Bearer ${maskToken(token)}`;
    } else {
      sanitized.authorization = "[REDACTED]";
    }
  }

  // Mask cookie header (may contain session tokens)
  if (sanitized.cookie) {
    sanitized.cookie = "[REDACTED]";
  }

  return sanitized;
}

/**
 * Sanitize error object to remove potentially sensitive data
 * @param error - Error object to sanitize
 * @returns Sanitized error data
 */
// Drizzle puts a failed query's bound values (ciphertexts, key names) in its error message.
export function withoutQueryParams(message: string): string {
  return message.replace(/\nparams: [\s\S]*$/, "\nparams: [redacted]");
}

export function sanitizeError(error: any): any {
  if (!error) {
    return error;
  }

  const message =
    typeof error.message === "string" ? withoutQueryParams(error.message) : error.message;

  // Create a clean copy with all useful debugging info
  const sanitized: any = {
    name: error.name,
    message,
    code: error.code,
    statusCode: error.statusCode,
    type: error.type,
  };

  // Always include stack trace - logs are private, not exposed to clients
  if (error.stack) {
    // The stack starts with the message: keep its frames, not the query's values
    sanitized.stack =
      message === error.message
        ? error.stack
        : String(error.stack)
            .replace(error.message, () => message)
            .replace(/\nparams: [\s\S]*?(?=\n\s+at |$)/, "\nparams: [redacted]");
  }

  // Include nested cause for better debugging
  if (error.cause) {
    sanitized.cause = sanitizeError(error.cause);
  }

  return sanitized;
}

/**
 * Query parameters that carry credentials: API tokens (legacy `keyway connect`), the
 * single-use authorize ticket, OAuth codes and states. Never logged, never sent to
 * Sentry or PostHog.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "ticket",
  "code",
  "state",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
]);

const REDACTED = "[REDACTED]";

export function isSensitiveQueryParam(name: string): boolean {
  let decoded = name;
  try {
    // The query parser decodes names (%74oken is read as token)
    decoded = decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    // keep the raw name
  }
  return SENSITIVE_QUERY_PARAMS.has(decoded.trim().toLowerCase());
}

/** Redacts the values of sensitive parameters in a query string (without the `?`). */
export function redactQueryString(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) {
        return pair;
      }
      const name = pair.slice(0, eq);
      return isSensitiveQueryParam(name) ? `${name}=${REDACTED}` : pair;
    })
    .join("&");
}

/** Redacts the values of sensitive query parameters in a URL (path or absolute). */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    return url;
  }
  const hashStart = url.indexOf("#", queryStart);
  const queryEnd = hashStart === -1 ? url.length : hashStart;
  return (
    url.slice(0, queryStart + 1) +
    redactQueryString(url.slice(queryStart + 1, queryEnd)) +
    url.slice(queryEnd)
  );
}

/**
 * Pino `req` serializer: Fastify's default one, with the URL redacted.
 * Used for the "incoming request" / "request completed" lines of every request.
 */
export function serializeRequestForLog(request: {
  method: string;
  url: string;
  headers?: Record<string, unknown>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}) {
  return {
    method: request.method,
    url: redactUrl(request.url),
    version: request.headers?.["accept-version"] as string | undefined,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket ? request.socket.remotePort : undefined,
  };
}

/**
 * Sanitize request object for safe logging
 * @param request - Fastify request object
 * @returns Sanitized request data
 */
export function sanitizeRequest(request: any): any {
  return {
    method: request.method,
    url: redactUrl(request.url),
    id: request.id,
    ip: request.ip,
    headers: sanitizeHeaders(request.headers || {}),
  };
}
