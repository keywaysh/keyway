#!/bin/bash

# Keyway Dev Stack Launcher
# Starts crypto service, backend, and dashboard with hot reload

set -e

# All paths relative to this script (monorepo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CRYPTO_DIR="$SCRIPT_DIR/packages/crypto"
BACKEND_DIR="$SCRIPT_DIR/packages/backend"
DASHBOARD_DIR="$SCRIPT_DIR/packages/dashboard"
CLI_DIR="$SCRIPT_DIR/packages/cli"
ENV_FILE="$SCRIPT_DIR/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}   Keyway Dev Stack Launcher${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
}

check_deps() {
    local missing=()

    if ! command -v pnpm &> /dev/null; then
        missing+=("pnpm (npm install -g pnpm)")
    fi

    if ! command -v go &> /dev/null; then
        missing+=("go (https://go.dev/dl/)")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Missing dependencies:${NC}"
        for dep in "${missing[@]}"; do
            echo -e "  - $dep"
        done
        exit 1
    fi
}

load_env() {
    if [ -f "$ENV_FILE" ]; then
        echo -e "${GREEN}Loading environment from $ENV_FILE${NC}"
        set -a
        source "$ENV_FILE"
        set +a
    else
        echo -e "${YELLOW}Warning: No .env file found at $ENV_FILE${NC}"
        echo -e "${YELLOW}Make sure ENCRYPTION_KEY, GITHUB_CLIENT_ID, etc. are set${NC}"
    fi
}

install_deps() {
    echo -e "${YELLOW}Installing dependencies...${NC}"

    echo -e "${GREEN}-> TypeScript packages (pnpm)${NC}"
    (cd "$SCRIPT_DIR" && pnpm install --silent)

    if [ -d "$CLI_DIR" ]; then
        echo -e "${GREEN}-> CLI (Go modules)${NC}"
        (cd "$CLI_DIR" && go mod download)
    fi

    if [ -d "$CRYPTO_DIR" ]; then
        echo -e "${GREEN}-> Crypto (Go modules)${NC}"
        (cd "$CRYPTO_DIR" && go mod download)
    fi

    echo ""
}

cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping all services...${NC}"
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

start_services() {
    echo -e "${GREEN}Starting services...${NC}"
    echo ""

    # Start crypto service (Go gRPC)
    if [ -d "$CRYPTO_DIR" ]; then
        echo -e "${CYAN}[Crypto]${NC} Starting gRPC service on :50051"
        (cd "$CRYPTO_DIR" && ENCRYPTION_KEY="$ENCRYPTION_KEY" go run .) &
        CRYPTO_PID=$!
        sleep 2  # Wait for crypto to be ready
    fi

    # Start backend
    if [ -d "$BACKEND_DIR" ]; then
        echo -e "${BLUE}[Backend]${NC} Starting on http://localhost:3000"
        (cd "$BACKEND_DIR" && pnpm dev) &
        BACKEND_PID=$!
        sleep 2  # Wait for backend to start
    fi

    # Start dashboard
    if [ -d "$DASHBOARD_DIR" ]; then
        echo -e "${GREEN}[Dashboard]${NC} Starting on http://localhost:3001"
        (cd "$DASHBOARD_DIR" && PORT=3001 pnpm dev) &
        DASHBOARD_PID=$!
    fi

    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}  All services running!${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "  Crypto:    ${CYAN}localhost:50051${NC} (gRPC)"
    echo -e "  Backend:   ${BLUE}http://localhost:3000${NC}"
    echo -e "  Dashboard: ${GREEN}http://localhost:3001${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    # Wait for all background processes
    wait
}

start_docker() {
    echo -e "${YELLOW}Starting with Docker Compose...${NC}"

    # Check for docker compose
    if ! docker compose version &> /dev/null; then
        echo -e "${RED}Error: docker compose is not installed${NC}"
        exit 1
    fi

    cd "$SCRIPT_DIR"
    docker compose up --build
}

show_help() {
    echo "Usage: ./dev.sh [command]"
    echo ""
    echo "Commands:"
    echo "  (none)     Start all services (crypto, backend, dashboard)"
    echo "  install    Install dependencies only"
    echo "  docker     Start with Docker Compose"
    echo "  backend    Start backend only"
    echo "  dashboard  Start dashboard only"
    echo "  crypto     Start crypto service only"
    echo "  cli        Build CLI binary"
    echo "  help       Show this help"
    echo ""
    echo "Environment:"
    echo "  Loads variables from $ENV_FILE"
    echo "  Required: ENCRYPTION_KEY, JWT_SECRET, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET"
}

# Main
print_header
check_deps
load_env

case "${1:-}" in
    install)
        install_deps
        echo -e "${GREEN}Done!${NC}"
        ;;
    docker)
        start_docker
        ;;
    backend)
        echo -e "${BLUE}Starting backend only...${NC}"
        (cd "$BACKEND_DIR" && pnpm dev)
        ;;
    dashboard)
        echo -e "${GREEN}Starting dashboard only...${NC}"
        (cd "$DASHBOARD_DIR" && pnpm dev)
        ;;
    crypto)
        echo -e "${CYAN}Starting crypto service only...${NC}"
        (cd "$CRYPTO_DIR" && ENCRYPTION_KEY="$ENCRYPTION_KEY" go run .)
        ;;
    cli)
        echo -e "${BLUE}Building CLI...${NC}"
        (cd "$CLI_DIR" && go build -o keyway .)
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        install_deps
        start_services
        ;;
esac
