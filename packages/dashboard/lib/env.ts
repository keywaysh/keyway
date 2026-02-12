import { z } from 'zod'

/**
 * Environment variable validation using Zod
 *
 * This module validates environment variables at build time and provides
 * type-safe access to them throughout the application.
 */

// Helper: treat empty strings as undefined (handles Docker Compose empty defaults like ${VAR:-})
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

// Optional URL/email fields that accept empty strings gracefully
const optionalUrl = () => z.preprocess(emptyToUndefined, z.string().url().optional())
const optionalEmail = () => z.preprocess(emptyToUndefined, z.string().email().optional())
const optionalString = () => z.preprocess(emptyToUndefined, z.string().optional())

// Schema for server-side environment variables
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // PostHog server-side (optional - for badge analytics)
  POSTHOG_SERVER_API_KEY: optionalString(),
  POSTHOG_HOST: optionalUrl(),
})

// Schema for client-side environment variables (NEXT_PUBLIC_*)
const clientEnvSchema = z.object({
  // Keyway API
  NEXT_PUBLIC_KEYWAY_API_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('https://api.keyway.sh'),
  ),

  // PostHog analytics (optional)
  NEXT_PUBLIC_POSTHOG_KEY: optionalString(),
  NEXT_PUBLIC_POSTHOG_HOST: optionalUrl(),

  // Sentry error tracking (optional)
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl(),

  // Crisp chat widget (optional)
  NEXT_PUBLIC_CRISP_WEBSITE_ID: optionalString(),

  // Self-hosting configuration
  NEXT_PUBLIC_DASHBOARD_URL: optionalUrl(),
  NEXT_PUBLIC_LANDING_URL: optionalUrl(),
  NEXT_PUBLIC_DOCS_URL: optionalUrl(),
  NEXT_PUBLIC_CONTACT_EMAIL: optionalEmail(),
  NEXT_PUBLIC_GITHUB_APP_INSTALL_URL: optionalUrl(),
  NEXT_PUBLIC_CLI_RELEASES_URL: optionalUrl(),
  NEXT_PUBLIC_BREW_TAP: optionalString(),
})

// Combine schemas
const envSchema = serverEnvSchema.merge(clientEnvSchema)

// Type for validated environment
export type Env = z.infer<typeof envSchema>

// Parse and validate environment variables
function validateEnv(): Env {
  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    POSTHOG_SERVER_API_KEY: process.env.POSTHOG_SERVER_API_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    NEXT_PUBLIC_KEYWAY_API_URL: process.env.NEXT_PUBLIC_KEYWAY_API_URL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
    NEXT_PUBLIC_DASHBOARD_URL: process.env.NEXT_PUBLIC_DASHBOARD_URL,
    NEXT_PUBLIC_LANDING_URL: process.env.NEXT_PUBLIC_LANDING_URL,
    NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL,
    NEXT_PUBLIC_CONTACT_EMAIL: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
    NEXT_PUBLIC_GITHUB_APP_INSTALL_URL: process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL,
    NEXT_PUBLIC_CLI_RELEASES_URL: process.env.NEXT_PUBLIC_CLI_RELEASES_URL,
    NEXT_PUBLIC_BREW_TAP: process.env.NEXT_PUBLIC_BREW_TAP,
  })

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)

    // In development, throw to catch issues early
    if (process.env.NODE_ENV === 'development') {
      throw new Error(`Invalid environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`)
    }

    // In production, return parsed data with defaults (Zod applies defaults for missing values)
    return envSchema.parse({})
  }

  return parsed.data
}

// Export validated environment
export const env = validateEnv()

// Type-safe accessors for common env vars
export const API_BASE = env.NEXT_PUBLIC_KEYWAY_API_URL
export const POSTHOG_KEY = env.NEXT_PUBLIC_POSTHOG_KEY
export const POSTHOG_HOST = env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com'
export const SENTRY_DSN = env.NEXT_PUBLIC_SENTRY_DSN
export const CRISP_WEBSITE_ID = env.NEXT_PUBLIC_CRISP_WEBSITE_ID
export const LANDING_URL = env.NEXT_PUBLIC_LANDING_URL ?? 'https://keyway.sh'
export const DOCS_URL = env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.keyway.sh'
export const CONTACT_EMAIL = env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@keyway.sh'
export const IS_PRODUCTION = env.NODE_ENV === 'production'
export const IS_DEVELOPMENT = env.NODE_ENV === 'development'
