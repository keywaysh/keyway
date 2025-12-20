.PHONY: build build-all run test test-coverage clean install lint dev

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

# Show help
help:
	@echo "Available targets:"
	@echo "  build       - Build for current platform"
	@echo "  build-all   - Build for all platforms"
	@echo "  run         - Run with ARGS (e.g., make run ARGS='--version')"
	@echo "  dev         - Same as run"
	@echo "  test        - Run tests"
	@echo "  test-coverage - Run tests with coverage report"
	@echo "  clean       - Remove build artifacts"
	@echo "  install     - Install to /usr/local/bin"
	@echo "  lint        - Run linter"
	@echo "  fmt         - Format code"
	@echo "  tidy        - Tidy go.mod"
	@echo "  deps        - Download dependencies"
