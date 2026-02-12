import { PostHog } from "posthog-node";
import { config } from "../config";

let posthog: PostHog | null = null;

/**
 * Initialize PostHog client
 */
export function initAnalytics() {
  if (!config.analytics.enabled) {
    return;
  }

  posthog = new PostHog(config.analytics.posthogApiKey!, {
    host: config.analytics.posthogHost,
  });
}

/**
 * Track an API event
 * IMPORTANT: Never include secret names, values, or any sensitive data
 */
export function trackEvent(distinctId: string, event: string, properties?: Record<string, any>) {
  if (!posthog) {
    return;
  }

  // Sanitize properties to ensure no sensitive data
  const sanitizedProperties = properties ? sanitizeProperties(properties) : {};

  posthog.capture({
    distinctId,
    event,
    properties: {
      ...sanitizedProperties,
      source: "api",
    },
  });
}

/**
 * Sanitize properties to remove any potential sensitive data
 */
function sanitizeProperties(properties: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    // Never include these sensitive fields
    if (
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("password") ||
      key.toLowerCase().includes("content") ||
      key.toLowerCase().includes("key")
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Identify a user in PostHog with their properties
 * Used for user property enrichment (signup source, timestamps, etc.)
 */
export function identifyUser(distinctId: string, properties: Record<string, any>) {
  if (!posthog) {
    return;
  }

  // Sanitize properties
  const sanitizedProperties = sanitizeProperties(properties);

  posthog.identify({
    distinctId,
    properties: sanitizedProperties,
  });
}

/**
 * Shutdown PostHog client gracefully
 */
export async function shutdownAnalytics() {
  if (posthog) {
    await posthog.shutdown();
  }
}

// Event names
export const AnalyticsEvents = {
  VAULT_INITIALIZED: "api_vault_initialized",
  SECRETS_PUSHED: "api_secrets_pushed",
  SECRETS_PULLED: "api_secrets_pulled",
  SECRET_VIEWED: "api_secret_viewed",
  AUTH_SUCCESS: "api_auth_success",
  AUTH_FAILURE: "api_auth_failure",
  USER_CREATED: "api_user_created",
  API_ERROR: "api_error",
  DEVICE_VERIFY_PAGE_VIEW: "api_device_verify_page_view",
  DEVICE_VERIFY_SUBMIT: "api_device_verify_submit",
  // Billing events
  BILLING_UPGRADE: "billing_upgrade",
  BILLING_DOWNGRADE: "billing_downgrade",
  BILLING_PAYMENT_FAILED: "billing_payment_failed",
} as const;

/**
 * Determine signup source from referer header
 */
export function getSignupSource(referer: string | undefined): string {
  if (!referer) {
    return "direct";
  }

  try {
    const url = new URL(referer);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    // Badge embed from README
    if (pathname.includes("badge")) {
      return "badge";
    }

    // GitHub README or docs
    if (hostname.includes("github.com") || hostname.includes("githubusercontent.com")) {
      return "github";
    }

    // NPM page
    if (hostname.includes("npmjs.com") || hostname.includes("npm.io")) {
      return "npm";
    }

    // Our own landing page
    const frontendHostname = new URL(config.app.frontendUrl).hostname;
    if (hostname === frontendHostname || hostname.endsWith(`.${frontendHostname}`)) {
      if (pathname === "/" || pathname === "") {
        return "landing";
      }
      if (pathname.includes("login")) {
        return "login";
      }
      return "site";
    }

    return "referrer";
  } catch {
    return "direct";
  }
}
