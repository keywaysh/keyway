import * as Sentry from "@sentry/node";
import { config } from "../config";
import { withoutQueryParams, redactUrl, redactQueryString, isSensitiveQueryParam } from "./logger";

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

      return scrubSensitiveRequestData(scrubQueryParams(event));
    },

    // Sanitize sensitive data (headers, credentials in URLs)
    beforeSendTransaction(event) {
      return scrubSensitiveRequestData(event);
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
        url: context.url ? redactUrl(context.url) : context.url,
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
    url: redactUrl(request.url),
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

type QueryString = string | Record<string, string> | Array<[string, string]>;

function redactQuery(query: QueryString): QueryString {
  if (typeof query === "string") {
    return redactQueryString(query);
  }
  if (Array.isArray(query)) {
    return query.map(([name, value]): [string, string] => [
      name,
      isSensitiveQueryParam(name) ? "[REDACTED]" : value,
    ]);
  }
  return Object.fromEntries(
    Object.entries(query).map(([name, value]) => [
      name,
      isSensitiveQueryParam(name) ? "[REDACTED]" : value,
    ])
  );
}

/** Redacts every string value of a flat record (span data, breadcrumb data, contexts). */
function redactUrlsIn(data: Record<string, unknown> | undefined): void {
  if (!data) {
    return;
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      data[key] = redactUrl(value);
    }
  }
}

/**
 * Removes credentials from what Sentry records about the incoming request: session
 * headers and cookies, and token / ticket / OAuth code / state in URLs and query strings
 * (request data, our "request" context, transaction name, span and breadcrumb data).
 */
export function scrubSensitiveRequestData<T extends Sentry.Event>(event: T): T {
  if (event.transaction) {
    event.transaction = redactUrl(event.transaction);
  }

  const request = event.request;
  if (request) {
    if (request.url) {
      request.url = redactUrl(request.url);
    }
    if (request.query_string) {
      request.query_string = redactQuery(request.query_string as QueryString);
    }
    if (request.headers) {
      const headers = { ...request.headers };
      delete headers["authorization"];
      delete headers["cookie"];
      request.headers = headers;
    }
    delete request.cookies;
  }

  for (const context of Object.values(event.contexts ?? {})) {
    if (context && typeof context === "object") {
      redactUrlsIn(context as Record<string, unknown>);
      redactUrlsIn((context as { data?: Record<string, unknown> }).data);
    }
  }
  for (const span of event.spans ?? []) {
    redactUrlsIn(span.data as Record<string, unknown> | undefined);
    if (span.description) {
      span.description = redactUrl(span.description);
    }
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    redactUrlsIn(breadcrumb.data);
  }

  return event;
}

/** Removes the bound values of a failed query from an error event. */
export function scrubQueryParams(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) {
    event.message = withoutQueryParams(event.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = withoutQueryParams(exception.value);
    }
  }
  return event;
}
