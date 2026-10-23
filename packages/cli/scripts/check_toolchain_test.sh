#!/bin/sh
# Tests check_toolchain.sh against a stubbed `go version`.
# Usage: sh scripts/check_toolchain_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/dist" "$TMP/odd" "$TMP/empty"
printf 'module example.com/cli\n\ngo 1.25.0\n\ntoolchain go1.26.10\n' > "$TMP/go.mod"
printf 'module example.com/cli\n\ngo 1.25.0\n' > "$TMP/go-no-toolchain.mod"

# GoReleaser's artifact list: only "Binary" entries are binaries to check.
cat > "$TMP/dist/artifacts.json" <<EOF
[
  {"name": "keyway", "path": "$TMP/dist/keyway_linux_amd64_v1/keyway", "type": "Binary"},
  {"name": "keyway.exe", "path": "$TMP/dist/keyway_windows_amd64_v1/keyway.exe", "type": "Binary"},
  {"name": "keyway_0.6.0_linux_amd64.tar.gz", "path": "$TMP/dist/keyway_0.6.0_linux_amd64.tar.gz", "type": "Archive"}
]
EOF
# Same list plus a binary outside the usual dist/<target>/ layout.
cat > "$TMP/odd/artifacts.json" <<EOF
[
  {"name": "keyway", "path": "$TMP/dist/keyway_linux_amd64_v1/keyway", "type": "Binary"},
  {"name": "keyway", "path": "$TMP/odd/nested/keyway", "type": "Binary"}
]
EOF
echo "[]" > "$TMP/empty/artifacts.json"

# Stub go: `go version <binary>` reports $FAKE_GO_VERSION, except for the
# odd-layout binary, which was built with an older toolchain.
cat > "$TMP/bin/go" <<'EOF'
#!/bin/sh
case "$2" in
  *nested*) echo "$2: go1.25.0" ;;
  *) echo "$2: $FAKE_GO_VERSION" ;;
esac
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
grep -q "2 binaries" "$TMP/out" || fail "every Binary artifact must be checked, and only those"

if run go1.25.0 "$TMP/go.mod" "$TMP/dist"; then fail "a binary built with another toolchain must fail"; fi
if run go1.26.10 "$TMP/go.mod" "$TMP/odd"; then fail "a binary outside dist/<target>/ must still be checked"; fi
if run go1.26.10 "$TMP/go.mod" "$TMP/empty"; then fail "a dist without binaries must fail"; fi
if run go1.26.10 "$TMP/go.mod" "$TMP/bin"; then fail "a dist without artifacts.json must fail"; fi
if run go1.26.10 "$TMP/go-no-toolchain.mod" "$TMP/dist"; then fail "a go.mod without toolchain directive must fail"; fi

echo "PASS: check_toolchain.sh"
