#!/bin/sh
# Tests install.sh latest-version resolution against a stubbed curl.
# Usage: sh scripts/install_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unset KEYWAY_VERSION

mkdir -p "$TMP/bin" "$TMP/out"

# Stub curl: like GitHub, the releases API returns 30 releases by default and
# up to 100 with per_page=100; every download fails.
cat > "$TMP/bin/curl" <<EOF
#!/bin/sh
for arg in "\$@"; do
  case "\$arg" in
    *"/download/"*) exit 22 ;;
    *"/releases"*"per_page=100"*) cat "$TMP/page-100.json"; exit 0 ;;
    *"/releases"*) cat "$TMP/page-default.json"; exit 0 ;;
  esac
done
exit 22
EOF
chmod +x "$TMP/bin/curl"

# write_releases TAG...: newest first, one release per line, "tag_name" on it.
write_releases() {
  i=0
  echo "[" > "$TMP/page-default.json"
  echo "[" > "$TMP/page-100.json"
  for tag in "$@"; do
    i=$((i + 1))
    line="  { \"tag_name\": \"$tag\", \"draft\": false },"
    [ "$i" -le 30 ] && echo "$line" >> "$TMP/page-default.json"
    echo "$line" >> "$TMP/page-100.json"
  done
  echo "]" >> "$TMP/page-default.json"
  echo "]" >> "$TMP/page-100.json"
}

run_install() {
  output=$(PATH="$TMP/bin:$PATH" KEYWAY_INSTALL_DIR="$TMP/out" sh "$SCRIPT_DIR/install.sh" 2>&1 || true)
}

fail() {
  printf 'FAIL: %s\n--- install.sh output ---\n%s\n' "$1" "$output"
  exit 1
}

# A prerelease newer than the latest stable release is skipped.
write_releases cli/v0.7.0-rc.1 mcp/v1.2.0 cli/v0.6.0
run_install
case "$output" in
  *"releases/download/cli%2Fv0.6.0/keyway_0.6.0_"*) ;;
  *) fail "expected the latest stable release v0.6.0" ;;
esac
case "$output" in
  *"0.7.0-rc.1"*) fail "a prerelease must never be selected by default" ;;
esac

# The latest stable CLI release is found beyond the API's default page.
n=0
tags=""
while [ "$n" -lt 34 ]; do
  n=$((n + 1))
  tags="$tags mcp/v1.0.$n"
done
# shellcheck disable=SC2086 # word splitting of $tags is intended
write_releases $tags cli/v0.6.0
run_install
case "$output" in
  *"releases/download/cli%2Fv0.6.0/keyway_0.6.0_"*) ;;
  *) fail "a stable release beyond the first 30 releases must be found" ;;
esac

echo "PASS: install.sh selects the latest stable cli/v* release"
