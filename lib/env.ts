import { z } from 'zod'

/**
 * Environment variable validation using Zod
 *
 * This module validates environment variables at build time and provides
 * type-safe access to them throughout the application.
 */

// Schema for server-side environment variables
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // PostHog server-side (optional - for badge analytics)
  POSTHOG_SERVER_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),
})

// Schema for client-side environment variables (NEXT_PUBLIC_*)
const clientEnvSchema = z.object({
  // Keyway API
  NEXT_PUBLIC_KEYWAY_API_URL: z
    .string()
    .url()
    .default('https://api.keyway.sh'),

  // PostHog analytics (optional)
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),

  // Sentry error tracking (optional)
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  // Crisp chat widget (optional)
  NEXT_PUBLIC_CRISP_WEBSITE_ID: z.string().optional(),
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
export const IS_PRODUCTION = env.NODE_ENV === 'production'
export const IS_DEVELOPMENT = env.NODE_ENV === 'development'
