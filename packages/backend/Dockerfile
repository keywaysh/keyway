FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Copy workspace config for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/docs/package.json ./packages/docs/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy backend source, proto, and migrations
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/proto ./packages/backend/proto
COPY packages/backend/drizzle ./packages/backend/drizzle
COPY packages/backend/tsconfig.json ./packages/backend/

# Build
WORKDIR /app/packages/backend
RUN pnpm run build

# Production image
FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/docs/package.json ./packages/docs/

# Install only production dependencies
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod

WORKDIR /app/packages/backend

# Copy built files, proto, and migrations
COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/proto ./proto
COPY --from=builder /app/packages/backend/drizzle ./drizzle

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run migrations then start server
CMD sh -c "node dist/db/migrate.js && node dist/index.js"
