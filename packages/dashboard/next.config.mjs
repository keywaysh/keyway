import { withSentryConfig } from '@sentry/nextjs';

const sentryEnabled = !!process.env.SENTRY_DSN;

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'github.com' },
    ],
    // Disable optimization when running behind local HTTPS proxy (Caddy)
    unoptimized: process.env.NEXT_PUBLIC_DISABLE_IMAGE_OPTIMIZATION === 'true',
  },
  experimental: {
    optimizePackageImports: ['@/app/components/dashboard'],
  },
};

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG || "keyway-0j",
      project: process.env.SENTRY_PROJECT || "keyway-dashboard",
      silent: !process.env.CI,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
      ...(process.env.VERCEL ? { automaticVercelMonitors: true } : {}),
      bundleSizeOptimizations: {
        excludeDebugStatements: true,
      },
    })
  : nextConfig;
