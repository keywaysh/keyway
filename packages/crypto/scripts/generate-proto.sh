#!/bin/bash
# Generate protobuf code using Docker (no local Go/protoc required)
# Run from packages/crypto/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRYPTO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTO_DIR="$(cd "$CRYPTO_DIR/../../proto" && pwd)"

docker run --rm -v "$CRYPTO_DIR":/app -v "$PROTO_DIR":/proto -w /app golang:1.22-alpine sh -c "
  apk add --no-cache protobuf protobuf-dev
  go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.1
  go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.0
  export PATH=\$PATH:\$(go env GOPATH)/bin
  protoc --go_out=. --go-grpc_out=. -I/proto /proto/crypto.proto
"
