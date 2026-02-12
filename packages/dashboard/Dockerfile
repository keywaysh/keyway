FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build args for Next.js public env vars
ARG NEXT_PUBLIC_KEYWAY_API_URL=https://api.keyway.sh
ARG NEXT_PUBLIC_DASHBOARD_URL=https://app.keyway.sh
ARG NEXT_PUBLIC_LANDING_URL=https://keyway.sh
ARG NEXT_PUBLIC_DOCS_URL=https://docs.keyway.sh
ARG NEXT_PUBLIC_DISABLE_IMAGE_OPTIMIZATION=false
ARG NEXT_PUBLIC_CRISP_WEBSITE_ID
ARG NEXT_PUBLIC_POSTHOG_KEY
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

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only (ignore prepare scripts like husky)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built app
COPY --from=builder /app/.next ./.next

# Expose port
EXPOSE 3000

# Start
CMD ["pnpm", "start"]
