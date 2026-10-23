#!/bin/sh
# Pushes a GoReleaser-generated formula to keywaysh/homebrew-tap.
# Refuses to push a missing or empty formula, or one that does not point at
# the cli/v<version> release assets.
# Usage: GH_TOKEN=<tap token> sh scripts/update_tap.sh <formula-file> <version>
set -eu

FORMULA_FILE=$1
VERSION=$2
TAP_REPO="keywaysh/homebrew-tap"
TAP_PATH="Formula/keyway.rb"

if [ ! -s "$FORMULA_FILE" ]; then
    echo "error: formula $FORMULA_FILE is missing or empty" >&2
    exit 1
fi

if ! grep -qF "releases/download/cli%2Fv${VERSION}/" "$FORMULA_FILE"; then
    echo "error: formula $FORMULA_FILE does not point at the cli/v${VERSION} release assets" >&2
    exit 1
fi

CONTENT=$(base64 < "$FORMULA_FILE" | tr -d '\n')
SHA=$(gh api "repos/${TAP_REPO}/contents/${TAP_PATH}" --jq .sha)

gh api -X PUT "repos/${TAP_REPO}/contents/${TAP_PATH}" \
    -f message="Brew formula update for keyway version v${VERSION}" \
    -f content="$CONTENT" \
    -f sha="$SHA" \
    -f "committer[name]=keywaysh-bot" \
    -f "committer[email]=bot@keyway.sh" > /dev/null

echo "Updated ${TAP_REPO}/${TAP_PATH} to v${VERSION}"
