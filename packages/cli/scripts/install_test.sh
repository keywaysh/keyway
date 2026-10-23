#!/bin/sh
# Tests install.sh latest-version resolution against a stubbed curl.
# Usage: sh scripts/install_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unset KEYWAY_VERSION

mkdir -p "$TMP/bin" "$TMP/out"

# Same shape as the GitHub releases API: newest first, one field per line.
cat > "$TMP/releases.json" <<'EOF'
[
  { "tag_name": "cli/v0.7.0-rc.1", "prerelease": true },
  { "tag_name": "mcp/v1.2.0", "prerelease": false },
  { "tag_name": "cli/v0.6.0", "prerelease": false }
]
EOF

# Stub curl: serve the fixture for the releases API, fail every download.
cat > "$TMP/bin/curl" <<EOF
#!/bin/sh
for arg in "\$@"; do
  case "\$arg" in
    *"/download/"*) exit 22 ;;
    *"/releases"*) cat "$TMP/releases.json"; exit 0 ;;
  esac
done
exit 22
EOF
chmod +x "$TMP/bin/curl"

output=$(PATH="$TMP/bin:$PATH" KEYWAY_INSTALL_DIR="$TMP/out" sh "$SCRIPT_DIR/install.sh" 2>&1 || true)

fail() {
  printf 'FAIL: %s\n--- install.sh output ---\n%s\n' "$1" "$output"
  exit 1
}

case "$output" in
  *"Installing keyway v0.6.0"*) ;;
  *) fail "expected the latest stable release v0.6.0" ;;
esac

case "$output" in
  *"0.7.0-rc.1"*) fail "a prerelease must never be selected by default" ;;
esac

echo "PASS: install.sh selects the latest stable cli/v* release"
