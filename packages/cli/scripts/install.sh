#!/bin/sh
# Keyway CLI installer
# Usage: curl -fsSL https://get.keyway.sh | sh
#    or: curl -fsSL https://raw.githubusercontent.com/keywaysh/cli/main/scripts/install.sh | sh

set -e

REPO="keywaysh/cli"
INSTALL_DIR="${KEYWAY_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="keyway"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info() {
    printf "${CYAN}info${NC}  %s\n" "$1"
}

success() {
    printf "${GREEN}success${NC}  %s\n" "$1"
}

warn() {
    printf "${YELLOW}warn${NC}  %s\n" "$1"
}

error() {
    printf "${RED}error${NC}  %s\n" "$1"
    exit 1
}

# Detect OS
detect_os() {
    OS="$(uname -s)"
    case "$OS" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="darwin" ;;
        MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
        *) error "Unsupported operating system: $OS" ;;
    esac
    echo "$OS"
}

# Detect architecture
detect_arch() {
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64) ARCH="amd64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    echo "$ARCH"
}

# Get latest version from GitHub
get_latest_version() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
}

# Download file
download() {
    URL="$1"
    OUTPUT="$2"

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$URL" -o "$OUTPUT"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$URL" -O "$OUTPUT"
    else
        error "Neither curl nor wget found."
    fi
}

main() {
    printf "\n"
    printf "  ${CYAN}keyway${NC} installer\n"
    printf "\n"

    OS=$(detect_os)
    ARCH=$(detect_arch)

    info "Detected OS: $OS, Arch: $ARCH"

    # Get version
    VERSION="${KEYWAY_VERSION:-$(get_latest_version)}"
    if [ -z "$VERSION" ]; then
        error "Could not determine latest version"
    fi

    # Remove 'v' prefix if present for filename
    VERSION_NUM="${VERSION#v}"

    info "Installing keyway $VERSION"

    # Determine archive format
    if [ "$OS" = "windows" ]; then
        EXT="zip"
    else
        EXT="tar.gz"
    fi

    # Build download URL
    FILENAME="${BINARY_NAME}_${VERSION_NUM}_${OS}_${ARCH}.${EXT}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${FILENAME}"

    info "Downloading from $DOWNLOAD_URL"

    # Create temp directory
    TMP_DIR=$(mktemp -d)
    trap "rm -rf $TMP_DIR" EXIT

    # Download
    ARCHIVE_PATH="${TMP_DIR}/${FILENAME}"
    download "$DOWNLOAD_URL" "$ARCHIVE_PATH"

    # Extract
    info "Extracting..."
    cd "$TMP_DIR"
    if [ "$EXT" = "zip" ]; then
        unzip -q "$ARCHIVE_PATH"
    else
        tar -xzf "$ARCHIVE_PATH"
    fi

    # Find binary
    if [ -f "${TMP_DIR}/${BINARY_NAME}" ]; then
        BINARY_PATH="${TMP_DIR}/${BINARY_NAME}"
    elif [ -f "${TMP_DIR}/${BINARY_NAME}.exe" ]; then
        BINARY_PATH="${TMP_DIR}/${BINARY_NAME}.exe"
        BINARY_NAME="${BINARY_NAME}.exe"
    else
        error "Binary not found in archive"
    fi

    # Install
    info "Installing to $INSTALL_DIR"

    # Check if we need sudo
    if [ -w "$INSTALL_DIR" ]; then
        mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
        chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    else
        warn "Need sudo to install to $INSTALL_DIR"
        sudo mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
        sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    # Verify installation
    if command -v keyway >/dev/null 2>&1; then
        success "keyway $VERSION installed successfully!"
        printf "\n"
        printf "  Run ${CYAN}keyway --help${NC} to get started\n"
        printf "\n"
    else
        warn "Installed but 'keyway' not found in PATH"
        printf "  Add ${CYAN}$INSTALL_DIR${NC} to your PATH:\n"
        printf "  export PATH=\"\$PATH:$INSTALL_DIR\"\n"
        printf "\n"
    fi
}

main "$@"
