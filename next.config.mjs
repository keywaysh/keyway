import { withSentryConfig } from '@sentry/nextjs';

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

export default withSentryConfig(nextConfig, {
  org: "keyway-0j",
  project: "keyway-dashboard",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    automaticVercelMonitors: true,
  },
});
