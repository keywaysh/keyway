#!/bin/sh
# Keyway CLI installer
# Usage: curl -fsSL https://keyway.sh/install.sh | sh

set -e

REPO="keywaysh/keyway"
BINARY_NAME="keyway"
INSTALL_DIR="${KEYWAY_INSTALL_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    printf "${BLUE}▸${NC} %s\n" "$1"
}

success() {
    printf "${GREEN}✓${NC} %s\n" "$1"
}

warn() {
    printf "${YELLOW}!${NC} %s\n" "$1"
}

error() {
    printf "${RED}✗${NC} %s\n" "$1" >&2
    exit 1
}

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="darwin" ;;
        MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
        *) error "Unsupported operating system: $OS" ;;
    esac

    case "$ARCH" in
        x86_64|amd64) ARCH="amd64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac

    PLATFORM="${OS}_${ARCH}"
}

# Get latest version from GitHub
get_latest_version() {
    # In the monorepo, CLI releases use cli/vX.X.X tags
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" | grep '"tag_name":' | grep 'cli/v' | head -1 | sed -E 's/.*"cli\/(v[^"]+)".*/\1/')
    if [ -z "$VERSION" ]; then
        error "Failed to get latest version"
    fi
}

# Download and install
install() {
    info "Detecting platform..."
    detect_platform
    success "Platform: $PLATFORM"

    info "Fetching latest version..."
    get_latest_version
    success "Version: $VERSION"

    # Construct download URL
    EXT="tar.gz"
    if [ "$OS" = "windows" ]; then
        EXT="zip"
    fi

    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/cli%2F${VERSION}/${BINARY_NAME}_${VERSION#v}_${PLATFORM}.${EXT}"

    info "Downloading from $DOWNLOAD_URL..."

    # Create temp directory
    TMP_DIR=$(mktemp -d)
    trap "rm -rf $TMP_DIR" EXIT

    # Download
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/keyway.$EXT"; then
        error "Failed to download. Check if the release exists for your platform."
    fi

    # Extract
    info "Extracting..."
    cd "$TMP_DIR"
    if [ "$EXT" = "zip" ]; then
        unzip -q "keyway.$EXT"
    else
        tar -xzf "keyway.$EXT"
    fi

    # Install
    info "Installing to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"

    if [ "$OS" = "windows" ]; then
        mv "${BINARY_NAME}.exe" "$INSTALL_DIR/"
    else
        mv "$BINARY_NAME" "$INSTALL_DIR/"
        chmod +x "$INSTALL_DIR/$BINARY_NAME"
    fi

    success "Installed $BINARY_NAME to $INSTALL_DIR"

    # Configure shell PATH if needed
    SHELL_CONFIGURED=""
    PATH_EXPORT='export PATH="$HOME/.local/bin:$PATH"'
    PATH_COMMENT="# Added by Keyway CLI installer"

    if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
        info "Configuring shell PATH..."

        # Configure zsh
        if [ -f "$HOME/.zshrc" ]; then
            if ! grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null; then
                echo "" >> "$HOME/.zshrc"
                echo "$PATH_COMMENT" >> "$HOME/.zshrc"
                echo "$PATH_EXPORT" >> "$HOME/.zshrc"
                success "Added PATH to ~/.zshrc"
                SHELL_CONFIGURED="zsh"
            fi
        fi

        # Configure bash
        if [ -f "$HOME/.bashrc" ]; then
            if ! grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
                echo "" >> "$HOME/.bashrc"
                echo "$PATH_COMMENT" >> "$HOME/.bashrc"
                echo "$PATH_EXPORT" >> "$HOME/.bashrc"
                success "Added PATH to ~/.bashrc"
                SHELL_CONFIGURED="bash"
            fi
        elif [ -f "$HOME/.bash_profile" ]; then
            if ! grep -q '.local/bin' "$HOME/.bash_profile" 2>/dev/null; then
                echo "" >> "$HOME/.bash_profile"
                echo "$PATH_COMMENT" >> "$HOME/.bash_profile"
                echo "$PATH_EXPORT" >> "$HOME/.bash_profile"
                success "Added PATH to ~/.bash_profile"
                SHELL_CONFIGURED="bash"
            fi
        fi

        # If no config file found, create .zshrc (most common on macOS)
        if [ -z "$SHELL_CONFIGURED" ] && [ ! -f "$HOME/.zshrc" ] && [ ! -f "$HOME/.bashrc" ]; then
            echo "$PATH_COMMENT" > "$HOME/.zshrc"
            echo "$PATH_EXPORT" >> "$HOME/.zshrc"
            success "Created ~/.zshrc with PATH"
            SHELL_CONFIGURED="zsh"
        fi
    fi

    echo ""
    success "Keyway CLI installed successfully!"
    echo ""

    # Show source command if PATH was just configured
    if [ -n "$SHELL_CONFIGURED" ]; then
        echo "  ${YELLOW}Run this to use keyway immediately:${NC}"
        if [ "$SHELL_CONFIGURED" = "zsh" ]; then
            echo "    source ~/.zshrc"
        else
            echo "    source ~/.bashrc"
        fi
        echo ""
        echo "  Or restart your terminal."
        echo ""
    fi

    echo "  Get started:"
    echo "    ${BLUE}keyway login${NC}    # Sign in with GitHub"
    echo "    ${BLUE}keyway init${NC}     # Initialize vault for this repo"
    echo "    ${BLUE}keyway push${NC}     # Upload secrets"
    echo "    ${BLUE}keyway pull${NC}     # Download secrets"
    echo ""
    echo "  Docs: https://docs.keyway.sh"
    echo ""
}

install
