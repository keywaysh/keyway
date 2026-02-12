# keyway-crypto

Go microservice for encrypting and decrypting [Keyway](https://keyway.sh) secrets using AES-256-GCM.

## Why a separate service?

This microservice isolates the encryption key from the main backend:

- **Security**: The `ENCRYPTION_KEY` never touches the Node.js backend
- **Isolation**: Can be deployed in a private VPC with no internet access
- **Performance**: Go's crypto is faster than Node.js for high-throughput scenarios
- **Auditability**: Smaller codebase, easier to audit

## Architecture

```
  Internet (untrusted)
         │
         ▼
┌─────────────────┐    gRPC (private network)   ┌─────────────────────┐
│  keyway-backend │ ◄──────────────────────────► │  keyway-crypto      │
│    (Node.js)    │         :50051               │       (Go)          │
└─────────────────┘                              └─────────────────────┘
                                                          │
                                                          ▼
                                                   ENCRYPTION_KEY
                                                  (env, never logged)
```

> **Important**: keyway-crypto must run on an isolated private network (Docker internal network, private VPC, or Kubernetes pod network). It must never be exposed to the public internet. See [SECURITY.md](./SECURITY.md) for the full threat model.

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
| `ENCRYPTION_KEY` | Single AES-256 key in hex (64 chars) | Yes* |
| `ENCRYPTION_KEYS` | Versioned keys for rotation (e.g., `1:key1,2:key2`) | Yes* |
| `GRPC_PORT` | gRPC server port (default: 50051) | No |

\* Either `ENCRYPTION_KEY` or `ENCRYPTION_KEYS` must be set. `ENCRYPTION_KEYS` takes priority if both are set.

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

## Security

See [SECURITY.md](./SECURITY.md) for the full threat model and vulnerability disclosure policy.

Key points:

1. **Network isolation required**: This service must run on a private network (Docker network, VPC). Never expose port 50051 to the internet.
2. **Key management**: Never commit `ENCRYPTION_KEY` to version control. Use a secrets manager in production.
3. **Key rotation**: Use `ENCRYPTION_KEYS` with versioned keys (e.g., `1:oldkey,2:newkey`) for zero-downtime rotation.
4. **Logging**: The service never logs plaintext, ciphertext, IVs, auth tags, or keys.
5. **mTLS**: Optional but recommended for high-security environments. Network isolation provides the baseline transport security.

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

MIT
