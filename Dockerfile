FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Copy workspace package files
COPY api/package*.json ./api/
COPY shared/package*.json ./shared/

# Install all dependencies (including workspace dependencies)
RUN npm install

# Copy shared source
COPY shared ./shared

# Build shared package first
WORKDIR /app/shared
RUN npm run build

# Copy API source
WORKDIR /app
COPY api ./api

# Build API
WORKDIR /app/api
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY api/package*.json ./
COPY shared/package*.json ./shared/

# Install only production dependencies
ENV NODE_ENV=production
RUN npm install --omit=dev

# Copy built files
COPY --from=builder /app/api/dist ./dist
COPY --from=builder /app/shared/dist ./shared/dist

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "dist/index.js"]
