#!/usr/bin/env bash
# Diagnose a local Keyway dev setup. Read-only; safe to run anytime.
# Surfaces the footguns that bite first-time local setups: missing env,
# Docker-only hostnames used in native runs, missing hosts/certs, wrong
# GitHub App slug, dashboard pointing at production, etc.
set -u

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
bad()  { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

echo -e "${BLUE}Keyway doctor${NC}"
echo "============="

# --- .env + required vars ---
echo ""
echo "  Environment:"
if [ -f "$ENV_FILE" ]; then
  ok ".env present"
  set -a; # shellcheck disable=SC1090
  . "$ENV_FILE"; set +a
else
  bad ".env missing — run 'make setup' or 'keyway pull -e dev'"
fi

for v in DATABASE_URL JWT_SECRET ENCRYPTION_KEY CRYPTO_SERVICE_URL \
         GITHUB_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET GITHUB_APP_PRIVATE_KEY; do
  if [ -n "${!v:-}" ]; then ok "$v set"; else bad "$v missing"; fi
done

case "${GITHUB_APP_NAME:-}" in
  ""|keyway-app)
    warn "GITHUB_APP_NAME='${GITHUB_APP_NAME:-unset}' looks wrong — it must be your GitHub App's public slug (the placeholder 'keyway-app' 404s the install URL)";;
  *) ok "GITHUB_APP_NAME=$GITHUB_APP_NAME";;
esac

# --- topology: native vs docker mismatch ---
echo ""
echo "  Topology: DOMAIN=${DOMAIN:-unset}  CADDYFILE=${CADDYFILE:-unset}"
case "${DATABASE_URL:-}" in
  *@db:*) warn "DATABASE_URL host 'db' only resolves inside the Docker network — use 'make docker', not native 'make dev'";;
esac
case "${CRYPTO_SERVICE_URL:-}" in
  crypto:*) warn "CRYPTO_SERVICE_URL host 'crypto' only resolves inside the Docker network — use 'make docker'";;
esac

# --- Caddy local dev prerequisites ---
echo ""
echo "  Caddy local dev (make docker):"
if grep -q "keyway.local" /etc/hosts 2>/dev/null; then ok "/etc/hosts has *.keyway.local"; else warn "/etc/hosts missing keyway.local — run 'make setup'"; fi
if [ -f "$ROOT_DIR/certs/local.pem" ] && [ -f "$ROOT_DIR/certs/local-key.pem" ]; then ok "mkcert certs present"; else warn "certs/local.pem missing — run 'make setup' (needs mkcert)"; fi

# --- dashboard target ---
echo ""
echo "  Dashboard:"
DASH_ENV="$ROOT_DIR/packages/dashboard/.env.local"
if [ -f "$DASH_ENV" ] && grep -q "NEXT_PUBLIC_KEYWAY_API_URL" "$DASH_ENV" 2>/dev/null; then
  ok "dashboard .env.local sets NEXT_PUBLIC_KEYWAY_API_URL"
else
  ok "no .env.local override — dashboard defaults to localhost in dev"
fi

# --- tooling ---
echo ""
echo "  Tooling:"
command -v pnpm   >/dev/null 2>&1 && ok "pnpm"   || bad "pnpm missing"
command -v go     >/dev/null 2>&1 && ok "go"     || bad "go missing"
command -v docker >/dev/null 2>&1 && ok "docker" || warn "docker missing (needed for 'make docker')"
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 && ok "docker daemon running" || warn "docker daemon not running"
fi

echo ""
echo -e "  ${BLUE}Tip:${NC} local dev = 'make docker' (Caddy + *.keyway.local). See CONTRIBUTING.md."
echo ""
