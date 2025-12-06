import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// Load environment variables
// Priority: .env.local > .env (for local development overrides)
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

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

  // GitHub App (unified auth + repo access)
  GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
  GITHUB_APP_CLIENT_ID: z.string().min(1, 'GITHUB_APP_CLIENT_ID is required'),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1, 'GITHUB_APP_CLIENT_SECRET is required'),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1, 'GITHUB_APP_PRIVATE_KEY is required'), // Base64-encoded PEM key
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_NAME: z.string().default('keyway-app'),

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

  // Admin
  ADMIN_SECRET: z.string().min(32).optional(),

  // Stripe Billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_TEAM_YEARLY: z.string().optional(),

  // Frontend URLs (for redirects after auth)
  FRONTEND_URL: z.string().url().optional(),
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

  app: {
    // Frontend URL for redirects after authentication
    // Defaults: https://keyway.sh (prod), https://localhost (dev)
    frontendUrl: env.FRONTEND_URL || (env.NODE_ENV === 'production' ? 'https://keyway.sh' : 'https://localhost'),
    dashboardPath: '/dashboard',
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

  // GitHub App provides both user authentication (OAuth) and repo access (installation tokens)
  github: {
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    apiBaseUrl: 'https://api.github.com',
  },

  githubApp: {
    appId: env.GITHUB_APP_ID,
    privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf8'),
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    name: env.GITHUB_APP_NAME,
    installUrl: `https://github.com/apps/${env.GITHUB_APP_NAME}/installations/new`,
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
    fromAddress: 'Keyway <hello@mail.keyway.sh>',
    replyToAddress: 'hello@keyway.sh',
  },

  admin: {
    secret: env.ADMIN_SECRET,
    enabled: !!env.ADMIN_SECRET,
  },

  stripe: env.STRIPE_SECRET_KEY
    ? {
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        prices: {
          proMonthly: env.STRIPE_PRICE_PRO_MONTHLY,
          proYearly: env.STRIPE_PRICE_PRO_YEARLY,
          teamMonthly: env.STRIPE_PRICE_TEAM_MONTHLY,
          teamYearly: env.STRIPE_PRICE_TEAM_YEARLY,
        },
      }
    : undefined,
} as const;

// Type export for usage in other files
export type Config = typeof config;
