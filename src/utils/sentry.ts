import * as Sentry from "@sentry/node";
import { config } from "../config";

let isInitialized = false;

/**
 * Initialize Sentry error tracking.
 * Must be called before Fastify starts.
 */
export function initSentry(): void {
  if (!config.sentry?.dsn) {
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.server.nodeEnv,
    release: config.sentry.release,

    // Performance monitoring
    tracesSampleRate: config.server.isProduction ? 0.1 : 1.0,

    // Only capture 5xx errors, not client errors (4xx)
    beforeSend(event, hint) {
      const error = hint.originalException;

      // Skip 4xx client errors - we only want server errors
      if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status: number }).status;
        if (status >= 400 && status < 500) {
          return null;
        }
      }

      // Also check statusCode (Fastify pattern)
      if (error && typeof error === "object" && "statusCode" in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        if (statusCode >= 400 && statusCode < 500) {
          return null;
        }
      }

      return event;
    },

    // Sanitize sensitive data
    beforeSendTransaction(event) {
      // Remove authorization headers from transaction data
      if (event.request?.headers) {
        const sanitizedHeaders = { ...event.request.headers };
        delete sanitizedHeaders["authorization"];
        delete sanitizedHeaders["cookie"];
        event.request.headers = sanitizedHeaders;
      }
      return event;
    },
  });

  isInitialized = true;
}

/**
 * Capture an error in Sentry with additional context.
 * Only captures 5xx errors by design.
 */
export function captureError(
  error: Error,
  context?: {
    requestId?: string;
    url?: string;
    method?: string;
    userId?: number;
    username?: string;
    extra?: Record<string, unknown>;
  }
): void {
  if (!isInitialized) {
    return;
  }

  Sentry.withScope((scope) => {
    // Set user context
    if (context?.userId || context?.username) {
      scope.setUser({
        id: context.userId?.toString(),
        username: context.username,
      });
    }

    // Set request context
    if (context?.requestId || context?.url || context?.method) {
      scope.setContext("request", {
        requestId: context.requestId,
        url: context.url,
        method: context.method,
      });
    }

    // Set tags for filtering
    scope.setTag("errorType", error.constructor.name);

    // Set extra data
    if (context?.extra) {
      scope.setExtras(context.extra);
    }

    Sentry.captureException(error);
  });
}

/**
 * Add request/user context to current Sentry scope.
 * Call this in onRequest hook.
 */
export function setSentryRequestContext(
  request: { id: string; url: string; method: string },
  user?: { forgeType: string; forgeUserId: string; username: string }
): void {
  if (!isInitialized) {
    return;
  }

  Sentry.setContext("request", {
    requestId: request.id,
    url: request.url,
    method: request.method,
  });

  if (user) {
    Sentry.setUser({
      id: `${user.forgeType}:${user.forgeUserId}`,
      username: user.username,
    });
  }
}

/**
 * Flush pending events and close Sentry client.
 * Call this during graceful shutdown.
 */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
  if (!isInitialized) {
    return;
  }

  await Sentry.close(timeoutMs);
}

export { Sentry };
