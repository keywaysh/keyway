FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/docs/package.json ./packages/docs/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy dashboard source
COPY packages/dashboard/ ./packages/dashboard/

WORKDIR /app/packages/dashboard

# Build args for Next.js public env vars
ARG NEXT_PUBLIC_KEYWAY_API_URL=https://api.keyway.sh
ARG NEXT_PUBLIC_DASHBOARD_URL=https://app.keyway.sh
ARG NEXT_PUBLIC_LANDING_URL=https://keyway.sh
ARG NEXT_PUBLIC_DOCS_URL=https://docs.keyway.sh
ARG NEXT_PUBLIC_DISABLE_IMAGE_OPTIMIZATION=false
ARG NEXT_PUBLIC_CRISP_WEBSITE_ID
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_GITHUB_APP_INSTALL_URL
ARG NEXT_PUBLIC_CLI_RELEASES_URL
ARG NEXT_PUBLIC_BREW_TAP
ARG NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_PUBLIC_KEYWAY_API_URL=$NEXT_PUBLIC_KEYWAY_API_URL
ENV NEXT_PUBLIC_DASHBOARD_URL=$NEXT_PUBLIC_DASHBOARD_URL
ENV NEXT_PUBLIC_LANDING_URL=$NEXT_PUBLIC_LANDING_URL
ENV NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL
ENV NEXT_PUBLIC_DISABLE_IMAGE_OPTIMIZATION=$NEXT_PUBLIC_DISABLE_IMAGE_OPTIMIZATION
ENV NEXT_PUBLIC_CRISP_WEBSITE_ID=$NEXT_PUBLIC_CRISP_WEBSITE_ID
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_GITHUB_APP_INSTALL_URL=$NEXT_PUBLIC_GITHUB_APP_INSTALL_URL
ENV NEXT_PUBLIC_CLI_RELEASES_URL=$NEXT_PUBLIC_CLI_RELEASES_URL
ENV NEXT_PUBLIC_BREW_TAP=$NEXT_PUBLIC_BREW_TAP
ENV NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js
RUN pnpm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/docs/package.json ./packages/docs/

# Install production dependencies only (ignore prepare scripts like husky)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

WORKDIR /app/packages/dashboard

# Copy built app, config, and public assets
COPY --from=builder /app/packages/dashboard/.next ./.next
COPY --from=builder /app/packages/dashboard/public ./public
COPY --from=builder /app/packages/dashboard/next.config.mjs ./

# Expose port
EXPOSE 3000

# Start
CMD ["pnpm", "start"]
