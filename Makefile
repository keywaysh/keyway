SHELL := /bin/bash

.PHONY: help setup install dev dev-backend dev-dashboard dev-crypto dev-docker \
	build build-cli build-crypto test test-backend test-dashboard test-cli test-crypto \
	lint format docker docker-build clean

# Colors
BLUE   := \033[0;34m
GREEN  := \033[0;32m
YELLOW := \033[1;33m
RED    := \033[0;31m
CYAN   := \033[0;36m
NC     := \033[0m

# Paths
ROOT_DIR   := $(CURDIR)
BACKEND    := $(ROOT_DIR)/packages/backend
DASHBOARD  := $(ROOT_DIR)/packages/dashboard
CRYPTO     := $(ROOT_DIR)/packages/crypto
CLI        := $(ROOT_DIR)/packages/cli
ENV_FILE   := $(ROOT_DIR)/.env

## help: Show all available targets (default)
help:
	@echo ""
	@echo "  Keyway Development"
	@echo "  =================="
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /' | sed 's/: /\t/'
	@echo ""

# ---------------------------------------------------------------------------
# Setup & Install
# ---------------------------------------------------------------------------

## setup: First-time setup (secrets, hosts, certs)
setup:
	@echo -e "$(BLUE)"
	@echo "  _  __                              "
	@echo " | |/ /___ _   ___      ____ _ _   _ "
	@echo " | ' // _ \ | | \ \ /\ / / _\` | | | |"
	@echo " | . \  __/ |_| |\ V  V / (_| | |_| |"
	@echo " |_|\_\___|\__, | \_/\_/ \__,_|\__, |"
	@echo "           |___/               |___/ "
	@echo -e "$(NC)"
	@echo "Setup"
	@echo "========================"
	@echo ""
	@# --- Step 1: Pull secrets with Keyway ---
	@echo -e "$(BLUE)Step 1: Pulling secrets with Keyway...$(NC)"
	@echo ""
	@KEYWAY_SUCCESS=false; \
	KEYWAY_CMD=""; \
	if command -v keyway > /dev/null 2>&1; then \
		KEYWAY_CMD="keyway"; \
		echo -e "  $(GREEN)✓$(NC) Keyway CLI found"; \
	elif command -v npx > /dev/null 2>&1; then \
		KEYWAY_CMD="npx -y @keywaysh/cli"; \
		echo -e "  $(YELLOW)→$(NC) Using npx @keywaysh/cli"; \
	else \
		echo -e "  $(YELLOW)!$(NC) Keyway CLI not found"; \
	fi; \
	if [ -n "$$KEYWAY_CMD" ]; then \
		echo ""; \
		echo -e "  $(YELLOW)→$(NC) Pulling secrets..."; \
		if $$KEYWAY_CMD pull --yes --file .env 2>/dev/null; then \
			echo -e "  $(GREEN)✓$(NC) Secrets pulled"; \
			KEYWAY_SUCCESS=true; \
		else \
			echo -e "  $(YELLOW)!$(NC) Could not pull secrets"; \
			echo ""; \
			echo -e "  $(BLUE)Tip:$(NC) Run 'keyway login' then re-run make setup"; \
		fi; \
	fi; \
	if [ "$$KEYWAY_SUCCESS" = false ]; then \
		echo ""; \
		echo -e "$(YELLOW)Falling back to manual setup...$(NC)"; \
		echo ""; \
		echo -e "$(BLUE)Step 2: Creating .env file...$(NC)"; \
		echo ""; \
		if [ -f ".env" ]; then \
			echo -e "  $(YELLOW)!$(NC) .env already exists (skipping)"; \
		else \
			cp .env.example .env; \
			echo -e "  $(GREEN)✓$(NC) Created .env from template"; \
		fi; \
		echo ""; \
		echo -e "$(BLUE)Step 3: Generating secrets...$(NC)"; \
		echo ""; \
		if ! grep -q "^ENCRYPTION_KEY=." .env 2>/dev/null; then \
			sed -i.bak "s/^ENCRYPTION_KEY=$$/ENCRYPTION_KEY=$$(openssl rand -hex 32)/" .env && rm -f .env.bak; \
			echo -e "  $(GREEN)✓$(NC) ENCRYPTION_KEY (generated)"; \
		else \
			echo -e "  $(GREEN)✓$(NC) ENCRYPTION_KEY (already set)"; \
		fi; \
		if ! grep -q "^JWT_SECRET=." .env 2>/dev/null; then \
			sed -i.bak "s/^JWT_SECRET=$$/JWT_SECRET=$$(openssl rand -base64 32)/" .env && rm -f .env.bak; \
			echo -e "  $(GREEN)✓$(NC) JWT_SECRET (generated)"; \
		else \
			echo -e "  $(GREEN)✓$(NC) JWT_SECRET (already set)"; \
		fi; \
		echo ""; \
		echo -e "$(BLUE)Step 4: Checking GitHub App configuration...$(NC)"; \
		echo ""; \
		ENV_COMPLETE=true; \
		for var in GITHUB_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET GITHUB_APP_PRIVATE_KEY; do \
			val=$$(grep "^$$var=" .env 2>/dev/null | cut -d'=' -f2-); \
			if [ -z "$$val" ]; then \
				echo -e "  $(RED)✗$(NC) $$var"; \
				ENV_COMPLETE=false; \
			else \
				echo -e "  $(GREEN)✓$(NC) $$var"; \
			fi; \
		done; \
		echo ""; \
		if [ "$$ENV_COMPLETE" = false ]; then \
			echo -e "$(YELLOW)════════════════════════════════════════════════════════════$(NC)"; \
			echo ""; \
			echo -e "$(YELLOW)Action required: Configure GitHub App$(NC)"; \
			echo ""; \
			echo "1. Create a GitHub App:"; \
			echo -e "   $(BLUE)https://github.com/settings/apps/new$(NC)"; \
			echo ""; \
			echo "   • Homepage URL: https://localhost"; \
			echo "   • Callback URL: https://localhost/v1/auth/callback"; \
			echo "   • Permissions: Repository metadata (read-only)"; \
			echo ""; \
			echo "2. Edit .env with your GitHub App values:"; \
			echo -e "   $(BLUE)nano .env$(NC)"; \
			echo ""; \
			echo "3. Then start the stack:"; \
			echo -e "   $(BLUE)docker compose up --build$(NC)"; \
			echo ""; \
			echo -e "$(YELLOW)════════════════════════════════════════════════════════════$(NC)"; \
			exit 0; \
		fi; \
	fi; \
	echo ""; \
	echo -e "$(BLUE)Configuring local domain (keyway.local)...$(NC)"; \
	echo ""; \
	if grep -q "keyway.local" /etc/hosts 2>/dev/null; then \
		echo -e "  $(GREEN)✓$(NC) /etc/hosts already configured"; \
	else \
		echo -e "  $(YELLOW)!$(NC) Adding keyway.local to /etc/hosts (requires sudo)"; \
		printf "# Keyway local development\n127.0.0.1 keyway.local\n127.0.0.1 app.keyway.local\n127.0.0.1 api.keyway.local\n" | sudo tee -a /etc/hosts > /dev/null; \
		if [ $$? -eq 0 ]; then \
			echo -e "  $(GREEN)✓$(NC) /etc/hosts configured"; \
		else \
			echo -e "  $(RED)✗$(NC) Failed to update /etc/hosts"; \
			echo -e "    Run manually: $(BLUE)echo '127.0.0.1 keyway.local app.keyway.local api.keyway.local' | sudo tee -a /etc/hosts$(NC)"; \
		fi; \
	fi; \
	echo ""; \
	echo -e "$(BLUE)Generating local SSL certificates...$(NC)"; \
	echo ""; \
	if command -v mkcert > /dev/null 2>&1; then \
		if [ ! -f "certs/local.pem" ]; then \
			mkdir -p certs; \
			mkcert -install 2>/dev/null || true; \
			mkcert -cert-file certs/local.pem -key-file certs/local-key.pem \
				keyway.local app.keyway.local api.keyway.local "*.keyway.local" 127.0.0.1 ::1; \
			echo -e "  $(GREEN)✓$(NC) Certificates generated"; \
		else \
			echo -e "  $(GREEN)✓$(NC) Certificates already exist"; \
		fi; \
	else \
		echo -e "  $(YELLOW)!$(NC) mkcert not found"; \
		echo -e "    Install it: $(BLUE)brew install mkcert$(NC)"; \
		echo -e "    Then run: $(BLUE)mkcert -install$(NC)"; \
	fi; \
	echo ""; \
	echo -e "$(GREEN)════════════════════════════════════════════════════════════$(NC)"; \
	echo ""; \
	echo -e "$(GREEN)Setup complete!$(NC)"; \
	echo ""; \
	echo "Start the stack:"; \
	echo -e "   $(BLUE)docker compose up --build$(NC)"; \
	echo ""; \
	echo "Access:"; \
	echo "   • Dashboard: https://app.keyway.local"; \
	echo "   • API:       https://api.keyway.local"; \
	echo ""; \
	echo "Use local CLI with local API:"; \
	echo -e "   $(BLUE)KEYWAY_API_URL=https://api.keyway.local keyway <command>$(NC)"; \
	echo ""; \
	echo -e "$(YELLOW)GitHub App Configuration:$(NC)"; \
	echo "   Callback URL: https://api.keyway.local/v1/auth/callback"; \
	echo ""; \
	echo -e "$(GREEN)════════════════════════════════════════════════════════════$(NC)"

## install: Install pnpm + Go dependencies
install:
	@echo -e "$(YELLOW)Installing dependencies...$(NC)"
	@echo -e "$(GREEN)-> TypeScript packages (pnpm)$(NC)"
	@pnpm install --silent
	@if [ -d "$(CLI)" ]; then \
		echo -e "$(GREEN)-> CLI (Go modules)$(NC)"; \
		cd $(CLI) && go mod download; \
	fi
	@if [ -d "$(CRYPTO)" ]; then \
		echo -e "$(GREEN)-> Crypto (Go modules)$(NC)"; \
		cd $(CRYPTO) && go mod download; \
	fi
	@echo ""
	@echo -e "$(GREEN)Done!$(NC)"

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------

## dev: Start all services (crypto, backend, dashboard)
dev:
	@# Check dependencies
	@command -v pnpm > /dev/null 2>&1 || { echo -e "$(RED)Missing: pnpm (npm install -g pnpm)$(NC)"; exit 1; }
	@command -v go > /dev/null 2>&1 || { echo -e "$(RED)Missing: go (https://go.dev/dl/)$(NC)"; exit 1; }
	@# Load .env if present
	@if [ -f "$(ENV_FILE)" ]; then \
		echo -e "$(GREEN)Loading environment from $(ENV_FILE)$(NC)"; \
	else \
		echo -e "$(YELLOW)Warning: No .env file found at $(ENV_FILE)$(NC)"; \
	fi
	@echo -e "$(BLUE)================================$(NC)"
	@echo -e "$(BLUE)   Keyway Dev Stack Launcher$(NC)"
	@echo -e "$(BLUE)================================$(NC)"
	@echo ""
	@# Install deps then start services
	@pnpm install --silent
	@if [ -d "$(CLI)" ]; then cd $(CLI) && go mod download; fi
	@if [ -d "$(CRYPTO)" ]; then cd $(CRYPTO) && go mod download; fi
	@echo -e "$(GREEN)Starting services...$(NC)"
	@echo ""
	@set -a; [ -f "$(ENV_FILE)" ] && . "$(ENV_FILE)"; set +a; \
	trap 'echo ""; echo -e "$(YELLOW)Stopping all services...$(NC)"; kill $$(jobs -p) 2>/dev/null; exit 0' INT TERM; \
	if [ -d "$(CRYPTO)" ]; then \
		echo -e "$(CYAN)[Crypto]$(NC) Starting gRPC service on :50051"; \
		(cd $(CRYPTO) && ENCRYPTION_KEY="$$ENCRYPTION_KEY" go run .) & \
		sleep 2; \
	fi; \
	if [ -d "$(BACKEND)" ]; then \
		echo -e "$(BLUE)[Backend]$(NC) Starting on http://localhost:3000"; \
		(cd $(BACKEND) && pnpm dev) & \
		sleep 2; \
	fi; \
	if [ -d "$(DASHBOARD)" ]; then \
		echo -e "$(GREEN)[Dashboard]$(NC) Starting on http://localhost:3001"; \
		(cd $(DASHBOARD) && PORT=3001 pnpm dev) & \
	fi; \
	echo ""; \
	echo -e "$(GREEN)================================$(NC)"; \
	echo -e "$(GREEN)  All services running!$(NC)"; \
	echo -e "$(GREEN)================================$(NC)"; \
	echo ""; \
	echo -e "  Crypto:    $(CYAN)localhost:50051$(NC) (gRPC)"; \
	echo -e "  Backend:   $(BLUE)http://localhost:3000$(NC)"; \
	echo -e "  Dashboard: $(GREEN)http://localhost:3001$(NC)"; \
	echo ""; \
	echo -e "$(YELLOW)Press Ctrl+C to stop all services$(NC)"; \
	echo ""; \
	wait

## dev-backend: Start backend only
dev-backend:
	@set -a; [ -f "$(ENV_FILE)" ] && . "$(ENV_FILE)"; set +a; \
	echo -e "$(BLUE)Starting backend...$(NC)"; \
	cd $(BACKEND) && pnpm dev

## dev-dashboard: Start dashboard only
dev-dashboard:
	@set -a; [ -f "$(ENV_FILE)" ] && . "$(ENV_FILE)"; set +a; \
	echo -e "$(GREEN)Starting dashboard...$(NC)"; \
	cd $(DASHBOARD) && pnpm dev

## dev-crypto: Start crypto gRPC service only
dev-crypto:
	@set -a; [ -f "$(ENV_FILE)" ] && . "$(ENV_FILE)"; set +a; \
	echo -e "$(CYAN)Starting crypto service...$(NC)"; \
	cd $(CRYPTO) && ENCRYPTION_KEY="$$ENCRYPTION_KEY" go run .

## dev-docker: Start full stack with Docker Compose
dev-docker: docker

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

## build: Build all packages (turbo + Go)
build:
	@pnpm build
	@if [ -d "$(CLI)" ]; then $(MAKE) -C $(CLI) build; fi
	@if [ -d "$(CRYPTO)" ]; then $(MAKE) -C $(CRYPTO) build; fi

## build-cli: Build CLI binary
build-cli:
	@$(MAKE) -C $(CLI) build

## build-crypto: Build crypto binary
build-crypto:
	@$(MAKE) -C $(CRYPTO) build

# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

## test: Run all tests
test:
	@pnpm test
	@if [ -d "$(CLI)" ]; then $(MAKE) -C $(CLI) test; fi
	@if [ -d "$(CRYPTO)" ]; then $(MAKE) -C $(CRYPTO) test; fi

## test-backend: Run backend tests
test-backend:
	@pnpm --filter keyway-api test

## test-dashboard: Run dashboard tests
test-dashboard:
	@pnpm --filter keyway-dashboard test

## test-cli: Run CLI tests
test-cli:
	@$(MAKE) -C $(CLI) test

## test-crypto: Run crypto tests
test-crypto:
	@$(MAKE) -C $(CRYPTO) test

# ---------------------------------------------------------------------------
# Lint & Format
# ---------------------------------------------------------------------------

## lint: Lint all packages
lint:
	@pnpm lint
	@if [ -d "$(CLI)" ]; then $(MAKE) -C $(CLI) lint; fi

## format: Format all code
format:
	@pnpm format 2>/dev/null || true
	@if [ -d "$(CLI)" ]; then cd $(CLI) && go fmt ./...; fi
	@if [ -d "$(CRYPTO)" ]; then cd $(CRYPTO) && go fmt ./...; fi

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

## docker: Start full stack with docker compose
docker:
	@docker compose up --build

## docker-build: Build Docker images only
docker-build:
	@docker compose build

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

## clean: Clean all build artifacts
clean:
	@rm -rf node_modules/.cache
	@if [ -d "$(CLI)" ]; then $(MAKE) -C $(CLI) clean; fi
	@if [ -d "$(CRYPTO)" ]; then $(MAKE) -C $(CRYPTO) clean; fi
	@echo -e "$(GREEN)Cleaned.$(NC)"
