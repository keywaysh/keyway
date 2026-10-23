#!/bin/sh
# Tests update_tap.sh against a stubbed gh that records its calls.
# Usage: sh scripts/update_tap_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
URL_BASE="https://github.com/keywaysh/keyway/releases/download"
printf 'class Keyway < Formula\n  url "%s/cli%%2Fv0.6.0/keyway_0.6.0_darwin_arm64.tar.gz"\nend\n' "$URL_BASE" > "$TMP/keyway.rb"
printf 'class Keyway < Formula\n  url "%s/cli%%2Fv0.5.9/keyway_0.5.9_darwin_arm64.tar.gz"\nend\n' "$URL_BASE" > "$TMP/old.rb"
: > "$TMP/empty.rb"

# Stub gh: log every call; the contents GET returns a fixed sha.
cat > "$TMP/bin/gh" <<EOF
#!/bin/sh
echo "\$*" >> "$TMP/gh.log"
case "\$*" in
  *"-X PUT"*) exit 0 ;;
  *) echo "abc123" ;;
esac
EOF
chmod +x "$TMP/bin/gh"

run() {
  rm -f "$TMP/gh.log"
  PATH="$TMP/bin:$PATH" sh "$SCRIPT_DIR/update_tap.sh" "$1" "$2" > "$TMP/out" 2>&1
}

fail() {
  printf 'FAIL: %s\n' "$1"
  cat "$TMP/out"
  exit 1
}

if run "$TMP/missing.rb" 0.6.0; then fail "a missing formula must fail"; fi
[ ! -e "$TMP/gh.log" ] || fail "a missing formula must not call gh"

if run "$TMP/empty.rb" 0.6.0; then fail "an empty formula must fail"; fi
[ ! -e "$TMP/gh.log" ] || fail "an empty formula must not call gh"

if run "$TMP/old.rb" 0.6.0; then fail "a formula for another version must fail"; fi
[ ! -e "$TMP/gh.log" ] || fail "a formula for another version must not call gh"

run "$TMP/keyway.rb" 0.6.0 || fail "a valid formula must be pushed"
grep -q -- "-X PUT repos/keywaysh/homebrew-tap/contents/Formula/keyway.rb" "$TMP/gh.log" || fail "must PUT Formula/keyway.rb on the tap"
grep -q -- "sha=abc123" "$TMP/gh.log" || fail "must send the current file sha"
grep -qF -- "content=$(base64 < "$TMP/keyway.rb" | tr -d '\n')" "$TMP/gh.log" || fail "must send the formula content base64-encoded"

echo "PASS: update_tap.sh"
