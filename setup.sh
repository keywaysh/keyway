#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "  _  __                              "
echo " | |/ /___ _   ___      ____ _ _   _ "
echo " | ' // _ \ | | \ \ /\ / / _\` | | | |"
echo " | . \  __/ |_| |\ V  V / (_| | |_| |"
echo " |_|\_\___|\__, | \_/\_/ \__,_|\__, |"
echo "           |___/               |___/ "
echo -e "${NC}"
echo "Local Development Setup"
echo "========================"
echo ""

# Ensure we're in the keyway-infra directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}Step 1: Cloning repositories...${NC}"
echo ""

REPOS=(
    "keyway-backend"
    "keyway-site"
    "keyway-cli"
    "keyway-crypto"
)

for repo in "${REPOS[@]}"; do
    if [ -d "$repo" ]; then
        echo -e "  ${GREEN}✓${NC} $repo (already exists)"
    else
        echo -e "  ${YELLOW}→${NC} Cloning $repo..."
        if git clone "git@github.com:keywaysh/$repo.git" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} $repo"
        else
            echo -e "  ${RED}✗${NC} Failed to clone $repo"
            echo -e "    Try: ${BLUE}git clone git@github.com:keywaysh/$repo.git${NC}"
            exit 1
        fi
    fi
done

echo ""
echo -e "${BLUE}Step 2: Creating .env file...${NC}"
echo ""

if [ -f ".env" ]; then
    echo -e "  ${YELLOW}!${NC} .env already exists (skipping)"
else
    cp .env.example .env
    echo -e "  ${GREEN}✓${NC} Created .env from template"
fi

echo ""
echo -e "${BLUE}Step 3: Checking configuration...${NC}"
echo ""

# Check if .env has required values
ENV_COMPLETE=true
check_env_var() {
    local var_name=$1
    local value=$(grep "^$var_name=" .env 2>/dev/null | cut -d'=' -f2-)
    if [ -z "$value" ]; then
        echo -e "  ${RED}✗${NC} $var_name"
        ENV_COMPLETE=false
    else
        echo -e "  ${GREEN}✓${NC} $var_name"
    fi
}

check_env_var "ENCRYPTION_KEY"
check_env_var "JWT_SECRET"
check_env_var "GITHUB_APP_ID"
check_env_var "GITHUB_APP_CLIENT_ID"
check_env_var "GITHUB_APP_CLIENT_SECRET"
check_env_var "GITHUB_APP_PRIVATE_KEY"

echo ""

if [ "$ENV_COMPLETE" = false ]; then
    echo -e "${YELLOW}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}Action required: Configure .env${NC}"
    echo ""
    echo "1. Generate keys:"
    echo -e "   ${BLUE}openssl rand -hex 32${NC}      # ENCRYPTION_KEY"
    echo -e "   ${BLUE}openssl rand -base64 32${NC}   # JWT_SECRET"
    echo ""
    echo "2. Create a GitHub App:"
    echo -e "   ${BLUE}https://github.com/settings/apps/new${NC}"
    echo ""
    echo "   • Homepage URL: https://localhost"
    echo "   • Callback URL: https://localhost/auth/callback"
    echo "   • Permissions: Repository metadata (read-only)"
    echo ""
    echo "3. Edit .env with your values:"
    echo -e "   ${BLUE}nano .env${NC}"
    echo ""
    echo "4. Then start the stack:"
    echo -e "   ${BLUE}docker compose up --build${NC}"
    echo ""
    echo -e "${YELLOW}════════════════════════════════════════════════════════════${NC}"
else
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${GREEN}Setup complete!${NC}"
    echo ""
    echo "Start the stack:"
    echo -e "   ${BLUE}docker compose up --build${NC}"
    echo ""
    echo "Access:"
    echo "   • Dashboard: https://localhost"
    echo "   • API:       https://localhost/api"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
fi
