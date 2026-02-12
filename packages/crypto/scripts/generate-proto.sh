#!/bin/bash
# Generate protobuf code using Docker (no local Go/protoc required)

docker run --rm -v "$(pwd)":/app -w /app golang:1.22-alpine sh -c "
  apk add --no-cache protobuf protobuf-dev
  go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
  go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
  export PATH=\$PATH:\$(go env GOPATH)/bin
  protoc --go_out=. --go-grpc_out=. proto/crypto.proto
"
