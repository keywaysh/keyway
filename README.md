# keyway-crypto

Microservice Go dédié au chiffrement/déchiffrement des secrets Keyway.

## Architecture

Service gRPC utilisant AES-256-GCM pour le chiffrement. Conçu pour être déployé dans un VPC privé, isolant la clé de chiffrement du backend principal.

```
┌─────────────────┐       gRPC         ┌─────────────────────┐
│  keyway-backend │ ◄────────────────► │  keyway-crypto      │
│    (Node.js)    │   localhost:50051  │       (Go)          │
└─────────────────┘                    └─────────────────────┘
                                              │
                                              ▼
                                       ENCRYPTION_KEY (env)
```

## Développement

### Prérequis

- Go 1.22+
- protoc (Protocol Buffers compiler)
- protoc-gen-go et protoc-gen-go-grpc

### Installation des outils

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

### Commandes

```bash
# Générer le code protobuf
make proto

# Compiler
make build

# Lancer (nécessite ENCRYPTION_KEY)
ENCRYPTION_KEY=<64-hex-chars> make run

# Tests
make test
make test-verbose

# Docker
make docker
ENCRYPTION_KEY=<64-hex-chars> make docker-run
```

## Configuration

| Variable | Description | Requis |
|----------|-------------|--------|
| `ENCRYPTION_KEY` | Clé AES-256 en hex (64 caractères) | Oui |

## API gRPC

### CryptoService

- `Encrypt(EncryptRequest) -> EncryptResponse`
- `Decrypt(DecryptRequest) -> DecryptResponse`
- `HealthCheck(Empty) -> HealthResponse`

Voir `proto/crypto.proto` pour les définitions complètes.

## Intégration backend

Le backend Node.js peut utiliser ce service via `CRYPTO_SERVICE_URL`:

```bash
# Sans remote crypto (chiffrement local)
pnpm run dev

# Avec remote crypto
CRYPTO_SERVICE_URL=localhost:50051 pnpm run dev
```

## Tests

Suite de tests complète couvrant:
- Validation des clés (taille, format hex)
- Chiffrement/déchiffrement round-trip
- Détection de tampering (ciphertext, IV, authTag)
- Concurrence (100 goroutines × 100 opérations)
- Encodage hex (compatibilité Node.js)
- Différentes tailles de données (1B à 10MB)

```bash
# Lancer tous les tests
go test ./...

# Avec coverage
go test -cover ./...

# Benchmarks
go test -bench=. ./crypto/
```
