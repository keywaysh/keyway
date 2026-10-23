#!/bin/sh
# Tests install.sh against stubbed curl and sudo, with HOME in a temp dir.
# Usage: sh scripts/install_test.sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unset KEYWAY_VERSION KEYWAY_INSTALL_DIR

mkdir -p "$TMP/bin" "$TMP/out" "$TMP/pkg"

# The release archive: a fake keyway binary.
printf '#!/bin/sh\necho "keyway version 0.6.0"\n' > "$TMP/pkg/keyway"
chmod +x "$TMP/pkg/keyway"
tar -czf "$TMP/archive.tar.gz" -C "$TMP/pkg" keyway

# Stub curl: like GitHub, the releases API returns 30 releases by default and
# up to 100 with per_page=100. Downloads fail unless $TMP/download-ok exists.
cat > "$TMP/bin/curl" <<EOF
#!/bin/sh
out=""
url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift ;;
    http*) url="\$1" ;;
  esac
  shift
done
case "\$url" in
  *"/download/"*)
    [ -f "$TMP/download-ok" ] || exit 22
    cp "$TMP/archive.tar.gz" "\$out"; exit 0 ;;
  *"/releases"*"per_page=100"*) cat "$TMP/page-100.json"; exit 0 ;;
  *"/releases"*) cat "$TMP/page-default.json"; exit 0 ;;
esac
exit 22
EOF
chmod +x "$TMP/bin/curl"

# Stub sudo: records the call and refuses, so an unexpected sudo fails loudly.
cat > "$TMP/bin/sudo" <<EOF
#!/bin/sh
echo "\$*" >> "$TMP/sudo-calls"
exit 1
EOF
chmod +x "$TMP/bin/sudo"

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
  output=$(HOME="$TMP/home" PATH="$TMP/bin:$PATH" KEYWAY_INSTALL_DIR="$TMP/out" sh "$SCRIPT_DIR/install.sh" 2>&1 || true)
}

# run_default_install: no KEYWAY_INSTALL_DIR, and a PATH without
# $TMP/home/.local/bin, like a fresh shell.
run_default_install() {
  output=$(HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" sh "$SCRIPT_DIR/install.sh" 2>&1 || true)
}

# reset_home: an empty HOME holding only the given dotfiles, and no sudo calls.
reset_home() {
  rm -rf "$TMP/home" "$TMP/sudo-calls"
  mkdir -p "$TMP/home"
  for f in "$@"; do
    echo "# existing $f" > "$TMP/home/$f"
  done
}

count_path_lines() {
  grep -c 'export PATH="$HOME/.local/bin:$PATH"' "$1" || true
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

# keyway.sh/install.sh has always installed to ~/.local/bin and put it first
# in PATH: installing anywhere else would leave an older keyway shadowing the
# new one.
write_releases cli/v0.6.0
touch "$TMP/download-ok"

# Default install: ~/.local/bin is created, no sudo.
reset_home .zshrc
run_default_install
[ -x "$TMP/home/.local/bin/keyway" ] || fail "keyway must be installed to ~/.local/bin by default"
[ "$("$TMP/home/.local/bin/keyway")" = "keyway version 0.6.0" ] || fail "installed binary is not the release binary"
[ ! -e "$TMP/sudo-calls" ] || fail "the default install must not use sudo"

# PATH: ~/.local/bin is added to an existing ~/.zshrc, once.
[ "$(count_path_lines "$TMP/home/.zshrc")" = 1 ] || fail "~/.zshrc must get the ~/.local/bin PATH line"
grep -q '^# existing .zshrc$' "$TMP/home/.zshrc" || fail "~/.zshrc content must be kept"
run_default_install
[ "$(count_path_lines "$TMP/home/.zshrc")" = 1 ] || fail "a second install must not add the PATH line again"

# PATH: ~/.bashrc is configured too, and ~/.bash_profile only without ~/.bashrc.
reset_home .bashrc .bash_profile
run_default_install
[ "$(count_path_lines "$TMP/home/.bashrc")" = 1 ] || fail "~/.bashrc must get the PATH line"
[ "$(count_path_lines "$TMP/home/.bash_profile")" = 0 ] || fail "~/.bash_profile must be left alone when ~/.bashrc exists"
reset_home .bash_profile
run_default_install
[ "$(count_path_lines "$TMP/home/.bash_profile")" = 1 ] || fail "~/.bash_profile must get the PATH line without ~/.bashrc"

# PATH: with no shell config at all, ~/.zshrc is created.
reset_home
run_default_install
[ "$(count_path_lines "$TMP/home/.zshrc")" = 1 ] || fail "~/.zshrc must be created when no shell config exists"

# PATH: nothing is written when ~/.local/bin is already in PATH.
reset_home .zshrc
output=$(HOME="$TMP/home" PATH="$TMP/home/.local/bin:$TMP/bin:/usr/bin:/bin" sh "$SCRIPT_DIR/install.sh" 2>&1 || true)
[ -x "$TMP/home/.local/bin/keyway" ] || fail "keyway must be installed when ~/.local/bin is in PATH"
[ "$(count_path_lines "$TMP/home/.zshrc")" = 0 ] || fail "PATH must not be configured when ~/.local/bin is already in it"

# Upgrade: an existing ~/.local/bin/keyway is replaced.
reset_home .zshrc
mkdir -p "$TMP/home/.local/bin"
printf '#!/bin/sh\necho "keyway version 0.5.3"\n' > "$TMP/home/.local/bin/keyway"
chmod +x "$TMP/home/.local/bin/keyway"
run_default_install
[ "$("$TMP/home/.local/bin/keyway")" = "keyway version 0.6.0" ] || fail "an existing ~/.local/bin/keyway must be upgraded"

# Custom KEYWAY_INSTALL_DIR: created without sudo, shell config untouched.
reset_home .zshrc
rm -rf "$TMP/custom"
output=$(HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" KEYWAY_INSTALL_DIR="$TMP/custom/bin" sh "$SCRIPT_DIR/install.sh" 2>&1 || true)
[ -x "$TMP/custom/bin/keyway" ] || fail "keyway must be installed to KEYWAY_INSTALL_DIR, created if missing"
[ ! -e "$TMP/sudo-calls" ] || fail "a writable KEYWAY_INSTALL_DIR must not use sudo"
[ "$(count_path_lines "$TMP/home/.zshrc")" = 0 ] || fail "a custom KEYWAY_INSTALL_DIR must not edit shell config"
[ ! -e "$TMP/home/.local/bin/keyway" ] || fail "a custom KEYWAY_INSTALL_DIR must not install to ~/.local/bin"

echo "PASS: install.sh installs to ~/.local/bin and configures PATH like keyway.sh/install.sh"
