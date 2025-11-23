#!/bin/bash

# Pre-push validation script
# Run this before pushing to main to ensure production won't break

set -e

echo "🔍 Running pre-push validation..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Type check
echo "📝 Running type check..."
if pnpm run type-check; then
  echo -e "${GREEN}✅ Type check passed${NC}"
else
  echo -e "${RED}❌ Type check failed${NC}"
  exit 1
fi
echo ""

# 2. Build
echo "🔨 Building project..."
if pnpm run build; then
  echo -e "${GREEN}✅ Build passed${NC}"
else
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi
echo ""

# 3. Check for required env vars in .env.example
echo "🔐 Checking environment variables..."
REQUIRED_VARS=(
  "PORT"
  "DATABASE_URL"
  "ENCRYPTION_KEY"
  "JWT_SECRET"
  "GITHUB_CLIENT_ID"
  "GITHUB_CLIENT_SECRET"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^$var=" .env.example; then
    MISSING_VARS+=("$var")
  fi
done

if [ ${#MISSING_VARS[@]} -eq 0 ]; then
  echo -e "${GREEN}✅ All required vars documented in .env.example${NC}"
else
  echo -e "${RED}❌ Missing vars in .env.example: ${MISSING_VARS[*]}${NC}"
  exit 1
fi
echo ""

# 4. Check migrations are up to date
echo "🗄️  Checking database migrations..."
if [ -d "drizzle" ] && [ "$(ls -A drizzle/*.sql 2>/dev/null)" ]; then
  echo -e "${GREEN}✅ Migrations exist${NC}"
else
  echo -e "${YELLOW}⚠️  No migrations found (might be normal)${NC}"
fi
echo ""

# 5. Test critical endpoints
if [ "$SKIP_API_TEST" != "1" ]; then
  echo "🧪 Testing critical API endpoints..."

  # Check if server is running
  if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:3000/health | jq -r '.status' 2>/dev/null || echo "error")

    if [ "$HEALTH" = "healthy" ]; then
      echo -e "${GREEN}✅ Health check passed${NC}"

      # Test device flow start
      DEVICE_START=$(curl -s -X POST http://localhost:3000/auth/device/start)
      if echo "$DEVICE_START" | jq -e '.deviceCode' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Device flow endpoint working${NC}"
      else
        echo -e "${RED}❌ Device flow endpoint broken${NC}"
        exit 1
      fi
    else
      echo -e "${RED}❌ Health check failed${NC}"
      exit 1
    fi
  else
    echo -e "${YELLOW}⚠️  Server not running locally, skipping API tests${NC}"
    echo -e "${YELLOW}   (Start server with 'pnpm dev' or set SKIP_API_TEST=1)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Skipping API tests (SKIP_API_TEST=1)${NC}"
fi
echo ""

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                        ║${NC}"
echo -e "${GREEN}║  ✅ All checks passed!                 ║${NC}"
echo -e "${GREEN}║  🚀 Safe to push to production         ║${NC}"
echo -e "${GREEN}║                                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
