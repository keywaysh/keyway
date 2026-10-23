#!/bin/sh
# Tests release_version.sh: tag parsing and strict semver validation.
# Usage: sh scripts/release_version_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}

expect_ok() { # expect_ok TAG EXPECTED_OUTPUT
  out=$(sh "$SCRIPT_DIR/release_version.sh" "$1" 2>&1) || fail "$1 must be accepted (got: $out)"
  [ "$out" = "$2" ] || fail "$1: expected '$2', got '$out'"
}

expect_rejected() { # expect_rejected TAG
  if sh "$SCRIPT_DIR/release_version.sh" "$1" > /dev/null 2>&1; then
    fail "$1 must be rejected"
  fi
}

expect_ok cli/v0.6.0 "version=0.6.0
prerelease=false"
expect_ok cli/v0.6.0-rc.1 "version=0.6.0-rc.1
prerelease=true"
expect_ok cli/v1.10.0-beta.2 "version=1.10.0-beta.2
prerelease=true"

# npm (strict semver) would reject these after the GitHub release is public.
expect_rejected cli/v0.06.0
expect_rejected cli/v0.6.0-rc.01
expect_rejected cli/v0.6.0-
expect_rejected cli/v0.6.0-.1
expect_rejected cli/v0.6
expect_rejected v0.6.0
expect_rejected mcp/v0.6.0

echo "PASS: release_version.sh"
