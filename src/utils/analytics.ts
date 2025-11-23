import { PostHog } from 'posthog-node';

let posthog: PostHog | null = null;

/**
 * Initialize PostHog client
 */
export function initAnalytics() {
  if (!process.env.POSTHOG_API_KEY) {
    console.warn('PostHog API key not found. Analytics disabled.');
    return;
  }

  posthog = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
  });

  console.log('PostHog analytics initialized');
}

/**
 * Track an API event
 * IMPORTANT: Never include secret names, values, or any sensitive data
 */
export function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, any>
) {
  if (!posthog) return;

  // Sanitize properties to ensure no sensitive data
  const sanitizedProperties = properties ? sanitizeProperties(properties) : {};

  posthog.capture({
    distinctId,
    event,
    properties: {
      ...sanitizedProperties,
      source: 'api',
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
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('content') ||
      key.toLowerCase().includes('key')
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
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
  VAULT_INITIALIZED: 'api_vault_initialized',
  SECRETS_PUSHED: 'api_secrets_pushed',
  SECRETS_PULLED: 'api_secrets_pulled',
  AUTH_SUCCESS: 'api_auth_success',
  AUTH_FAILURE: 'api_auth_failure',
  API_ERROR: 'api_error',
} as const;
