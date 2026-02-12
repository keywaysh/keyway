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
export function sanitizeError(error: any): any {
  if (!error) {
    return error;
  }

  // Create a clean copy with all useful debugging info
  const sanitized: any = {
    name: error.name,
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    type: error.type,
  };

  // Always include stack trace - logs are private, not exposed to clients
  if (error.stack) {
    sanitized.stack = error.stack;
  }

  // Include nested cause for better debugging
  if (error.cause) {
    sanitized.cause = sanitizeError(error.cause);
  }

  return sanitized;
}

/**
 * Sanitize request object for safe logging
 * @param request - Fastify request object
 * @returns Sanitized request data
 */
export function sanitizeRequest(request: any): any {
  return {
    method: request.method,
    url: request.url,
    id: request.id,
    ip: request.ip,
    headers: sanitizeHeaders(request.headers || {}),
  };
}
