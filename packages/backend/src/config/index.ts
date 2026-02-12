import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

// Load environment variables
// Priority: .env.local > .env (for local development overrides)
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

// Helper: treat empty strings as undefined (handles Docker Compose empty defaults like ${VAR:-})
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

// Optional URL field that accepts empty strings gracefully
const optionalUrl = () => z.preprocess(emptyToUndefined, z.string().url().optional());

// Environment schema with validation
const envSchema = z
  .object({
    // Server
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().default("3000").transform(Number),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.string().default("info"),

    // Database
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // Encryption (remote crypto service)
    CRYPTO_SERVICE_URL: z.string().min(1, "CRYPTO_SERVICE_URL is required (e.g., localhost:50051)"),

    // JWT for Keyway tokens
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

    // GitHub App (unified auth + repo access)
    GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required"),
    GITHUB_APP_CLIENT_ID: z.string().min(1, "GITHUB_APP_CLIENT_ID is required"),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1, "GITHUB_APP_CLIENT_SECRET is required"),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1, "GITHUB_APP_PRIVATE_KEY is required"), // Base64-encoded PEM key
    GITHUB_APP_WEBHOOK_SECRET: z.string().optional(), // Required in production (validated below)
    GITHUB_APP_NAME: z.string().default("keyway-app"),

    // Analytics
    POSTHOG_API_KEY: z.string().optional(),
    POSTHOG_HOST: z.preprocess(
      emptyToUndefined,
      z.string().url().default("https://app.posthog.com")
    ),

    // CORS
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((val) => (val ? val.split(",").map((s) => s.trim()) : [])),

    // Security detection (optional - ipinfo.io works without token for 50k req/month)
    IPINFO_TOKEN: z.string().optional(),

    // Provider integrations (optional)
    VERCEL_CLIENT_ID: z.string().optional(),
    VERCEL_CLIENT_SECRET: z.string().optional(),
    NETLIFY_CLIENT_ID: z.string().optional(),
    NETLIFY_CLIENT_SECRET: z.string().optional(),

    // Email (Resend)
    RESEND_API_KEY: z.string().optional(),

    // Stripe Billing
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
    STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
    STRIPE_PRICE_TEAM_YEARLY: z.string().optional(),
    STRIPE_PRICE_STARTUP_MONTHLY: z.string().optional(),
    STRIPE_PRICE_STARTUP_YEARLY: z.string().optional(),

    // Frontend URLs (for redirects after auth)
    FRONTEND_URL: optionalUrl(), // Landing page (marketing)
    DASHBOARD_URL: optionalUrl(), // Dashboard app

    // Sentry Error Tracking (optional)
    SENTRY_DSN: optionalUrl(),
    SENTRY_RELEASE: z.string().optional(),

    // Self-hosting config
    DOCS_URL: optionalUrl(),
    ERROR_BASE_URL: optionalUrl(),
    EMAIL_FROM_ADDRESS: z.string().optional(),
    EMAIL_FROM_NAME: z.string().optional(),
    BILLING_ENABLED: z
      .string()
      .optional()
      .transform((val) => val !== "false"), // defaults to true
    GITHUB_BASE_URL: optionalUrl(), // GitHub API URL (e.g., https://api.github.com or https://github.example.com/api/v3)
    GITHUB_URL: optionalUrl(), // GitHub web URL for OAuth (e.g., https://github.com or https://github.example.com)
    GITHUB_APP_INSTALL_URL: optionalUrl(),

    // Rate limiting
    RATE_LIMIT_MAX: z
      .string()
      .optional()
      .transform((val) => (val ? Number(val) : 100)),
    RATE_LIMIT_WINDOW: z.string().optional().default("15 minutes"),
  })
  .superRefine((data, ctx) => {
    // SECURITY: Webhook secret is required in production to prevent forged webhook attacks
    if (data.NODE_ENV === "production" && !data.GITHUB_APP_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GITHUB_APP_WEBHOOK_SECRET is required in production mode",
        path: ["GITHUB_APP_WEBHOOK_SECRET"],
      });
    }
  });

// Validate environment variables
const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error("❌ Invalid environment variables:");
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
    isDevelopment: env.NODE_ENV === "development",
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
  },

  app: {
    // Landing page URL (marketing site)
    // Defaults: https://keyway.sh (prod), http://localhost:3001 (dev)
    frontendUrl:
      env.FRONTEND_URL ||
      (env.NODE_ENV === "production" ? "https://keyway.sh" : "http://localhost:3001"),
    // Dashboard URL (authenticated app)
    // Defaults: https://app.keyway.sh (prod), http://localhost:3000 (dev)
    dashboardUrl:
      env.DASHBOARD_URL ||
      (env.NODE_ENV === "production" ? "https://app.keyway.sh" : "http://localhost:3000"),
    // Docs URL
    // Defaults: <frontendUrl>/docs (prod), http://localhost:3002 (dev)
    docsUrl:
      env.DOCS_URL ||
      (env.NODE_ENV === "production"
        ? `${env.FRONTEND_URL || "https://keyway.sh"}/docs`
        : "http://localhost:3002"),
  },

  database: {
    url: env.DATABASE_URL,
  },

  crypto: {
    serviceUrl: env.CRYPTO_SERVICE_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    accessTokenExpiresIn: "7d", // 7 days for access tokens
    refreshTokenExpiresIn: "90d", // 90 days for refresh tokens
  },

  // GitHub App provides both user authentication (OAuth) and repo access (installation tokens)
  github: {
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    apiBaseUrl: env.GITHUB_BASE_URL || "https://api.github.com",
    // Web URL for OAuth flows and user-facing links (defaults to https://github.com)
    // For GitHub Enterprise: set to your GHE hostname (e.g., https://github.example.com)
    url: env.GITHUB_URL || "https://github.com",
  },

  githubApp: {
    appId: env.GITHUB_APP_ID,
    privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8"),
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    name: env.GITHUB_APP_NAME,
    installUrl:
      env.GITHUB_APP_INSTALL_URL ||
      `https://github.com/apps/${env.GITHUB_APP_NAME}/installations/new`,
  },

  analytics: {
    posthogApiKey: env.POSTHOG_API_KEY,
    posthogHost: env.POSTHOG_HOST,
    enabled: !!env.POSTHOG_API_KEY,
  },

  cors: {
    // In production, allow landing and dashboard by default
    // In development with no ALLOWED_ORIGINS, allow all
    allowedOrigins:
      env.ALLOWED_ORIGINS.length > 0
        ? env.ALLOWED_ORIGINS
        : env.NODE_ENV === "production"
          ? [
              env.FRONTEND_URL || "https://keyway.sh",
              env.DASHBOARD_URL || "https://app.keyway.sh",
            ].filter(Boolean)
          : [],
    allowAll: env.ALLOWED_ORIGINS.length === 0 && env.NODE_ENV === "development",
  },

  security: {
    ipinfoToken: env.IPINFO_TOKEN,
  },

  vercel:
    env.VERCEL_CLIENT_ID && env.VERCEL_CLIENT_SECRET
      ? {
          clientId: env.VERCEL_CLIENT_ID,
          clientSecret: env.VERCEL_CLIENT_SECRET,
        }
      : undefined,

  netlify:
    env.NETLIFY_CLIENT_ID && env.NETLIFY_CLIENT_SECRET
      ? {
          clientId: env.NETLIFY_CLIENT_ID,
          clientSecret: env.NETLIFY_CLIENT_SECRET,
        }
      : undefined,

  email: {
    resendApiKey: env.RESEND_API_KEY,
    enabled: !!env.RESEND_API_KEY,
    fromAddress: env.EMAIL_FROM_ADDRESS || "Keyway <hello@mail.keyway.sh>",
    replyToAddress: env.EMAIL_FROM_NAME || "hello@keyway.sh",
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
          startupMonthly: env.STRIPE_PRICE_STARTUP_MONTHLY,
          startupYearly: env.STRIPE_PRICE_STARTUP_YEARLY,
        },
      }
    : undefined,

  billing: {
    enabled: env.BILLING_ENABLED && !!env.STRIPE_SECRET_KEY,
  },

  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    window: env.RATE_LIMIT_WINDOW,
  },

  errors: {
    baseUrl: env.ERROR_BASE_URL || "https://api.keyway.sh/errors",
  },

  sentry: env.SENTRY_DSN
    ? {
        dsn: env.SENTRY_DSN,
        release: env.SENTRY_RELEASE || "unknown",
        enabled: true,
      }
    : undefined,
} as const;

// Type export for usage in other files
export type Config = typeof config;
