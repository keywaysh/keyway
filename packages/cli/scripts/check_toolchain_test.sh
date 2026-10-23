#!/bin/sh
# Tests check_toolchain.sh against a stubbed `go version`.
# Usage: sh scripts/check_toolchain_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/dist/keyway_linux_amd64_v1" "$TMP/dist/keyway_windows_amd64_v1" "$TMP/empty"
: > "$TMP/dist/keyway_linux_amd64_v1/keyway"
: > "$TMP/dist/keyway_windows_amd64_v1/keyway.exe"
printf 'module example.com/cli\n\ngo 1.25.0\n\ntoolchain go1.26.10\n' > "$TMP/go.mod"
printf 'module example.com/cli\n\ngo 1.25.0\n' > "$TMP/go-no-toolchain.mod"

# Stub go: `go version <binary>` reports $FAKE_GO_VERSION.
cat > "$TMP/bin/go" <<'EOF'
#!/bin/sh
echo "$2: $FAKE_GO_VERSION"
EOF
chmod +x "$TMP/bin/go"

run() {
  FAKE_GO_VERSION=$1 PATH="$TMP/bin:$PATH" sh "$SCRIPT_DIR/check_toolchain.sh" "$2" "$3" > "$TMP/out" 2>&1
}

fail() {
  printf 'FAIL: %s\n' "$1"
  cat "$TMP/out"
  exit 1
}

run go1.26.10 "$TMP/go.mod" "$TMP/dist" || fail "binaries built with the pinned toolchain must pass"
grep -q "2 binaries" "$TMP/out" || fail "both the unix and the windows binary must be checked"

if run go1.25.0 "$TMP/go.mod" "$TMP/dist"; then fail "a binary built with another toolchain must fail"; fi
if run go1.26.10 "$TMP/go.mod" "$TMP/empty"; then fail "a dist without binaries must fail"; fi
if run go1.26.10 "$TMP/go-no-toolchain.mod" "$TMP/dist"; then fail "a go.mod without toolchain directive must fail"; fi

echo "PASS: check_toolchain.sh"
