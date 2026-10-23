#!/bin/sh
# Keyway CLI installer
# Usage: curl -fsSL https://keyway.sh/install.sh | sh
#    or: curl -fsSL https://raw.githubusercontent.com/keywaysh/keyway/main/packages/cli/scripts/install.sh | sh
# keyway.sh/install.sh redirects here.

set -e

REPO="keywaysh/keyway"
# keyway.sh/install.sh has always installed to ~/.local/bin and put it first in
# PATH: installing elsewhere would leave an older keyway shadowing the new one.
DEFAULT_INSTALL_DIR="$HOME/.local/bin"
INSTALL_DIR="${KEYWAY_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
BINARY_NAME="keyway"
PATH_EXPORT='export PATH="$HOME/.local/bin:$PATH"'
PATH_COMMENT="# Added by Keyway CLI installer"
SHELL_CONFIG_FILE=""

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

# Get latest CLI version from GitHub (filter for cli/v* tags)
get_latest_version() {
    # The monorepo also publishes mcp/v* releases: look past the default 30.
    local api_url="https://api.github.com/repos/${REPO}/releases?per_page=100"
    local json
    if command -v curl >/dev/null 2>&1; then
        json=$(curl -fsSL "$api_url")
    elif command -v wget >/dev/null 2>&1; then
        json=$(wget -qO- "$api_url")
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
    # Find latest stable cli/vX.Y.Z tag (prereleases excluded) and strip the cli/ prefix
    echo "$json" | grep '"tag_name"' | grep -E '"cli/v[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | sed -E 's/.*"cli\/(v[^"]+)".*/\1/'
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

# Append the ~/.local/bin PATH line to a shell config file, unless it already
# mentions .local/bin.
add_path_line() {
    if grep -q '.local/bin' "$1" 2>/dev/null; then
        return 1
    fi
    printf '\n%s\n%s\n' "$PATH_COMMENT" "$PATH_EXPORT" >> "$1"
    success "Added ~/.local/bin to PATH in $1"
    SHELL_CONFIG_FILE="$1"
}

# Put ~/.local/bin in PATH for zsh and bash, creating ~/.zshrc if no config exists.
configure_path() {
    info "Configuring shell PATH"
    if [ -f "$HOME/.zshrc" ]; then
        add_path_line "$HOME/.zshrc" || true
    fi
    if [ -f "$HOME/.bashrc" ]; then
        add_path_line "$HOME/.bashrc" || true
    elif [ -f "$HOME/.bash_profile" ]; then
        add_path_line "$HOME/.bash_profile" || true
    fi
    if [ -z "$SHELL_CONFIG_FILE" ] && [ ! -f "$HOME/.zshrc" ] && [ ! -f "$HOME/.bashrc" ]; then
        printf '%s\n%s\n' "$PATH_COMMENT" "$PATH_EXPORT" > "$HOME/.zshrc"
        success "Created ~/.zshrc with ~/.local/bin in PATH"
        SHELL_CONFIG_FILE="$HOME/.zshrc"
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
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/cli%2F${VERSION}/${FILENAME}"

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

    # Sudo only for a KEYWAY_INSTALL_DIR the user cannot write to
    if mkdir -p "$INSTALL_DIR" 2>/dev/null && [ -w "$INSTALL_DIR" ]; then
        mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
        chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    elif [ "$INSTALL_DIR" = "$DEFAULT_INSTALL_DIR" ]; then
        # sudo here would leave a root-owned binary in the user's home
        error "Cannot write to $INSTALL_DIR. Fix its ownership or set KEYWAY_INSTALL_DIR."
    else
        warn "Need sudo to install to $INSTALL_DIR"
        sudo mkdir -p "$INSTALL_DIR"
        sudo mv "$BINARY_PATH" "${INSTALL_DIR}/${BINARY_NAME}"
        sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    success "keyway $VERSION installed successfully!"
    printf "\n"

    case ":$PATH:" in
        *":$INSTALL_DIR:"*)
            RESOLVED=$(command -v "$BINARY_NAME" 2>/dev/null || true)
            if [ -n "$RESOLVED" ] && [ "$RESOLVED" != "${INSTALL_DIR}/${BINARY_NAME}" ]; then
                warn "$RESOLVED comes first in your PATH and will run instead of ${INSTALL_DIR}/${BINARY_NAME}"
                printf "  Remove it (brew uninstall keyway, npm uninstall -g @keywaysh/cli) or put ${CYAN}$INSTALL_DIR${NC} first in your PATH\n"
            else
                printf "  Run ${CYAN}keyway --help${NC} to get started\n"
            fi
            ;;
        *)
            if [ "$INSTALL_DIR" = "$DEFAULT_INSTALL_DIR" ]; then
                configure_path
            fi
            if [ -n "$SHELL_CONFIG_FILE" ]; then
                printf "\n  Restart your terminal or run: ${CYAN}source $SHELL_CONFIG_FILE${NC}\n"
            else
                warn "$INSTALL_DIR is not in your PATH. Add it with:"
                printf "  export PATH=\"$INSTALL_DIR:\$PATH\"\n"
            fi
            ;;
    esac
    printf "\n"
}

main "$@"
