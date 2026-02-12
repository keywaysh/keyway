.PHONY: build build-all run test test-coverage clean install lint dev prepare-npm

VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"
BINARY := keyway

# Default target
all: build

# Build for current platform
build:
	go build $(LDFLAGS) -o bin/$(BINARY) ./cmd/keyway

# Build for all platforms
build-all:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY)-darwin-arm64 ./cmd/keyway
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-darwin-x64 ./cmd/keyway
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-linux-x64 ./cmd/keyway
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY)-linux-arm64 ./cmd/keyway
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-windows-x64.exe ./cmd/keyway

# Run with arguments
run:
	go run ./cmd/keyway $(ARGS)

# Dev mode - run with arguments
dev:
	go run ./cmd/keyway $(ARGS)

# Run tests
test:
	go test -v -race ./...

# Run tests with coverage
test-coverage:
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

# Run tests with coverage (business logic only, excludes delegation wrappers)
test-coverage-logic:
	@go test -coverprofile=coverage.out ./internal/cmd/...
	@echo ""
	@echo "=== Coverage Summary ==="
	@echo ""
	@echo "Raw coverage (all code):"
	@go tool cover -func=coverage.out | grep "total:"
	@echo ""
	@echo "Business logic coverage (WithDeps functions + pure functions):"
	@go tool cover -func=coverage.out | grep -E "WithDeps|normalize|compare|preview|mask|format|build|isFalse|mapTo|getProject|project|trimSpace|hasPrefix" | awk '{ \
		split($$3, pct, "%"); \
		if ($$3 == "100.0%") covered += 1; \
		else if ($$3 == "0.0%") covered += 0; \
		else { covered += pct[1]/100; } \
		total += 1; \
	} END { printf "  %.1f%% (%d functions)\n", (covered/total)*100, total }'
	@echo ""
	@echo "Note: Raw coverage is lower because it includes:"
	@echo "  - deps_real.go: thin delegation wrappers (0%)"
	@echo "  - runXXX wrappers: just call WithDeps versions (0%)"
	@echo "  - Unrefactored commands: connect, sync, scan, login"

# Clean build artifacts
clean:
	rm -rf bin/ dist/ coverage.out coverage.html

# Install to /usr/local/bin
install: build
	cp bin/$(BINARY) /usr/local/bin/$(BINARY)
	@echo "Installed $(BINARY) to /usr/local/bin/"

# Lint
lint:
	golangci-lint run

# Format code
fmt:
	go fmt ./...

# Tidy dependencies
tidy:
	go mod tidy

# Download dependencies
deps:
	go mod download

# Prepare npm package (copy README)
prepare-npm:
	cp README.md npm/README.md
	@echo "Copied README.md to npm/"

# Show help
help:
	@echo "Available targets:"
	@echo "  build        - Build for current platform"
	@echo "  build-all    - Build for all platforms"
	@echo "  run          - Run with ARGS (e.g., make run ARGS='--version')"
	@echo "  dev          - Same as run"
	@echo "  test         - Run tests"
	@echo "  test-coverage - Run tests with coverage report"
	@echo "  clean        - Remove build artifacts"
	@echo "  install      - Install to /usr/local/bin"
	@echo "  lint         - Run linter"
	@echo "  fmt          - Format code"
	@echo "  tidy         - Tidy go.mod"
	@echo "  deps         - Download dependencies"
	@echo "  prepare-npm  - Copy README to npm/"
