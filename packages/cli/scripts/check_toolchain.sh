#!/bin/sh
# Fails unless every binary GoReleaser built (the "Binary" entries of
# <dist-dir>/artifacts.json) uses the toolchain pinned in go.mod.
# Usage: sh scripts/check_toolchain.sh <go.mod> <dist-dir>
set -eu

GO_MOD=$1
DIST=$2

WANT=$(awk '$1 == "toolchain" { print $2 }' "$GO_MOD")
if [ -z "$WANT" ]; then
    echo "error: no toolchain directive in $GO_MOD" >&2
    exit 1
fi

if [ ! -f "$DIST/artifacts.json" ]; then
    echo "error: $DIST/artifacts.json not found" >&2
    exit 1
fi

BINARIES=$(jq -r '.[] | select(.type == "Binary") | .path' "$DIST/artifacts.json")

count=0
for bin in $BINARIES; do
    got=$(go version "$bin" | awk '{ print $NF }')
    if [ "$got" != "$WANT" ]; then
        echo "error: $bin was built with $got, expected $WANT" >&2
        exit 1
    fi
    count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
    echo "error: no binaries listed in $DIST/artifacts.json" >&2
    exit 1
fi

echo "OK: $count binaries built with $WANT"
