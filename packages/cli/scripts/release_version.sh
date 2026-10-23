#!/bin/sh
# Parses a CLI release tag (cli/vX.Y.Z or cli/vX.Y.Z-PRERELEASE) and prints
# GitHub Actions outputs. Rejects anything npm's strict semver would refuse,
# so a bad tag fails before the GitHub release is published.
# Usage: sh scripts/release_version.sh "$GITHUB_REF_NAME" >> "$GITHUB_OUTPUT"
set -eu

TAG=$1

NUM='(0|[1-9][0-9]*)'
PRE_ID='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
SEMVER="^${NUM}\.${NUM}\.${NUM}(-${PRE_ID}(\.${PRE_ID})*)?\$"

case "$TAG" in
    cli/v*) VERSION=${TAG#cli/v} ;;
    *)
        echo "error: $TAG is not a cli/v* tag" >&2
        exit 1
        ;;
esac

if ! printf '%s\n' "$VERSION" | grep -Eq "$SEMVER"; then
    echo "error: $TAG is not cli/vMAJOR.MINOR.PATCH[-PRERELEASE] (strict semver)" >&2
    exit 1
fi

case "$VERSION" in
    *-*) PRERELEASE=true ;;
    *) PRERELEASE=false ;;
esac

echo "version=$VERSION"
echo "prerelease=$PRERELEASE"
