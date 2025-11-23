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

  // Encryption
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .regex(/^[0-9a-f]+$/i, 'ENCRYPTION_KEY must be hexadecimal'),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string().min(1, 'GITHUB_CLIENT_ID is required'),
  GITHUB_CLIENT_SECRET: z.string().min(1, 'GITHUB_CLIENT_SECRET is required'),
  GITHUB_REDIRECT_URI: z.string().url().optional(),

  // Analytics
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().default('https://app.posthog.com'),

  // CORS
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((s) => s.trim()) : [])),
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

  encryption: {
    key: Buffer.from(env.ENCRYPTION_KEY, 'hex'),
    algorithm: 'aes-256-gcm' as const,
    ivLength: 16,
    authTagLength: 16,
  },

  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    redirectUri: env.GITHUB_REDIRECT_URI,
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
} as const;

// Type export for usage in other files
export type Config = typeof config;
