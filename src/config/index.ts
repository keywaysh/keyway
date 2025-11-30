import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment schema with validation
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Encryption (remote crypto service)
  CRYPTO_SERVICE_URL: z.string().min(1, 'CRYPTO_SERVICE_URL is required (e.g., localhost:50051)'),

  // JWT for Keyway tokens
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string().min(1, 'GITHUB_CLIENT_ID is required'),
  GITHUB_CLIENT_SECRET: z.string().min(1, 'GITHUB_CLIENT_SECRET is required'),

  // Analytics
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().default('https://app.posthog.com'),

  // CORS
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((s) => s.trim()) : [])),

  // Security detection (optional - ipinfo.io works without token for 50k req/month)
  IPINFO_TOKEN: z.string().optional(),

  // Provider integrations (optional)
  VERCEL_CLIENT_ID: z.string().optional(),
  VERCEL_CLIENT_SECRET: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
});

// Validate environment variables
const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(envResult.error.format());
  process.exit(1);
}

const env = envResult.data;

// Export typed configuration
export const config = {
  server: {
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  },

  database: {
    url: env.DATABASE_URL,
  },

  crypto: {
    serviceUrl: env.CRYPTO_SERVICE_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    accessTokenExpiresIn: '7d', // 7 days for access tokens
    refreshTokenExpiresIn: '90d', // 90 days for refresh tokens
  },

  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    apiBaseUrl: 'https://api.github.com',
  },

  analytics: {
    posthogApiKey: env.POSTHOG_API_KEY,
    posthogHost: env.POSTHOG_HOST,
    enabled: !!env.POSTHOG_API_KEY,
  },

  cors: {
    allowedOrigins: env.ALLOWED_ORIGINS,
    allowAll: env.ALLOWED_ORIGINS.length === 0 && env.NODE_ENV === 'development',
  },

  security: {
    ipinfoToken: env.IPINFO_TOKEN,
  },

  vercel: env.VERCEL_CLIENT_ID && env.VERCEL_CLIENT_SECRET
    ? {
        clientId: env.VERCEL_CLIENT_ID,
        clientSecret: env.VERCEL_CLIENT_SECRET,
      }
    : undefined,

  email: {
    resendApiKey: env.RESEND_API_KEY,
    enabled: !!env.RESEND_API_KEY,
    fromAddress: 'Keyway <hello@keyway.sh>',
  },
} as const;

// Type export for usage in other files
export type Config = typeof config;
