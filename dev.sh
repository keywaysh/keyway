#!/bin/bash

# Keyway Dev Stack Launcher
# Starts backend, frontend, and optionally watches CLI

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/keyway-backend"
SITE_DIR="$SCRIPT_DIR/keyway-site"
CLI_DIR="$SCRIPT_DIR/keyway-cli"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}   Keyway Dev Stack Launcher${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
}

check_deps() {
    if ! command -v pnpm &> /dev/null; then
        echo -e "${RED}Error: pnpm is required but not installed.${NC}"
        echo "Install with: npm install -g pnpm"
        exit 1
    fi
}

install_deps() {
    echo -e "${YELLOW}Installing dependencies...${NC}"

    if [ -d "$BACKEND_DIR" ]; then
        echo -e "${GREEN}-> Backend${NC}"
        (cd "$BACKEND_DIR" && pnpm install --silent)
    fi

    if [ -d "$SITE_DIR" ]; then
        echo -e "${GREEN}-> Site${NC}"
        (cd "$SITE_DIR" && pnpm install --silent)
    fi

    if [ -d "$CLI_DIR" ]; then
        echo -e "${GREEN}-> CLI${NC}"
        (cd "$CLI_DIR" && pnpm install --silent)
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

    # Start backend
    if [ -d "$BACKEND_DIR" ]; then
        echo -e "${BLUE}[Backend]${NC} Starting on http://localhost:3001"
        (cd "$BACKEND_DIR" && pnpm dev) &
        BACKEND_PID=$!
    fi

    # Wait a bit for backend to start
    sleep 2

    # Start frontend
    if [ -d "$SITE_DIR" ]; then
        echo -e "${BLUE}[Site]${NC} Starting on http://localhost:3000"
        (cd "$SITE_DIR" && pnpm dev) &
        SITE_PID=$!
    fi

    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}  All services running!${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "  Backend: ${BLUE}http://localhost:3001${NC}"
    echo -e "  Site:    ${BLUE}http://localhost:3000${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    # Wait for all background processes
    wait
}

# Main
print_header
check_deps

case "${1:-}" in
    install)
        install_deps
        echo -e "${GREEN}Done!${NC}"
        ;;
    backend)
        echo -e "${BLUE}Starting backend only...${NC}"
        (cd "$BACKEND_DIR" && pnpm dev)
        ;;
    site)
        echo -e "${BLUE}Starting site only...${NC}"
        (cd "$SITE_DIR" && pnpm dev)
        ;;
    cli)
        echo -e "${BLUE}Starting CLI watch mode...${NC}"
        (cd "$CLI_DIR" && pnpm build:watch)
        ;;
    *)
        install_deps
        start_services
        ;;
esac
