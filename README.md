# keyway-crypto

Microservice Go for encrypting/decrypting Keyway secrets using AES-256-GCM.

## Why a separate service?

This microservice isolates the encryption key from the main backend:

- **Security**: The `ENCRYPTION_KEY` never touches the Node.js backend
- **Isolation**: Can be deployed in a private VPC with no internet access
- **Performance**: Go's crypto is faster than Node.js for high-throughput scenarios
- **Auditability**: Smaller codebase, easier to audit

## Architecture

```
┌─────────────────┐       gRPC (mTLS)      ┌─────────────────────┐
│  keyway-backend │ ◄────────────────────► │  keyway-crypto      │
│    (Node.js)    │      :50051            │       (Go)          │
└─────────────────┘                        └─────────────────────┘
                                                   │
                                                   ▼
                                            ENCRYPTION_KEY
                                           (env, never logged)
```

## Encryption Details

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key size | 256 bits (32 bytes, 64 hex chars) |
| IV | 12 bytes, random per encryption |
| Auth tag | 16 bytes |

Each encryption produces a unique ciphertext even for identical plaintext (random IV).

## Quick Start

### With Docker (recommended)

```bash
# Generate a random key
openssl rand -hex 32

# Run
docker build -t keyway-crypto .
docker run -p 50051:50051 -e ENCRYPTION_KEY=<64-hex-chars> keyway-crypto
```

### Local Development

```bash
# Prerequisites: Go 1.22+, protoc, protoc-gen-go, protoc-gen-go-grpc

# Install protobuf tools
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Build and run
make proto    # Generate gRPC code
make build    # Compile binary
ENCRYPTION_KEY=<64-hex-chars> make run
```

## Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `ENCRYPTION_KEY` | AES-256 key in hex (64 chars) | Yes |
| `PORT` | gRPC server port (default: 50051) | No |

### Generating a secure key

```bash
# macOS/Linux
openssl rand -hex 32

# Output example: a625f804488864fd89a46dbb5abf6962e475dccb8a5674636102b0c3e60dcc1e
```

## gRPC API

### CryptoService

```protobuf
service CryptoService {
  rpc Encrypt(EncryptRequest) returns (EncryptResponse);
  rpc Decrypt(DecryptRequest) returns (DecryptResponse);
  rpc HealthCheck(Empty) returns (HealthResponse);
}
```

#### Encrypt

```protobuf
message EncryptRequest {
  string plaintext = 1;  // UTF-8 string to encrypt
}

message EncryptResponse {
  string ciphertext = 1;  // Hex-encoded ciphertext
  string iv = 2;          // Hex-encoded IV (12 bytes)
  string auth_tag = 3;    // Hex-encoded auth tag (16 bytes)
}
```

#### Decrypt

```protobuf
message DecryptRequest {
  string ciphertext = 1;  // Hex-encoded ciphertext
  string iv = 2;          // Hex-encoded IV
  string auth_tag = 3;    // Hex-encoded auth tag
}

message DecryptResponse {
  string plaintext = 1;   // Decrypted UTF-8 string
}
```

## Testing

Comprehensive test suite with 40+ tests covering:

| Category | Tests |
|----------|-------|
| Key validation | Empty, too short, too long, invalid hex |
| Round-trip | Encrypt then decrypt, verify equality |
| Tampering detection | Modified ciphertext, IV, auth tag |
| Edge cases | Empty plaintext, null bytes, unicode |
| Concurrency | 100 goroutines × 100 ops |
| Data sizes | 1 byte to 10 MB |

```bash
# Run all tests
make test

# Verbose output
make test-verbose

# With coverage
go test -cover ./...

# Benchmarks
go test -bench=. ./crypto/
```

## Integration with keyway-backend

The Node.js backend automatically uses this service when `CRYPTO_SERVICE_URL` is set:

```bash
# Without crypto service (local encryption in Node.js)
pnpm run dev

# With crypto service
CRYPTO_SERVICE_URL=localhost:50051 pnpm run dev

# In Docker Compose
CRYPTO_SERVICE_URL=crypto:50051
```

## Security Considerations

1. **Key management**: Never commit `ENCRYPTION_KEY` to version control
2. **Network**: Deploy in a private network, use mTLS in production
3. **Logging**: The service never logs plaintext or keys
4. **Memory**: Sensitive data is not retained after request completion

## Make Commands

```bash
make proto         # Generate protobuf code
make build         # Build binary
make run           # Run server (requires ENCRYPTION_KEY)
make test          # Run tests
make test-verbose  # Run tests with verbose output
make docker        # Build Docker image
make docker-run    # Run Docker container (requires ENCRYPTION_KEY)
make clean         # Remove build artifacts
```

## License

Private - Keyway
