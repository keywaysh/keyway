# Security Policy

## Threat Model

keyway-crypto is an **internal encryption microservice** that handles AES-256-GCM encryption and decryption for the Keyway platform. It is designed to run on an **isolated private network** and must never be exposed directly to the public internet.

### What this service protects against

- **Database compromise**: Secrets are encrypted at rest. An attacker who gains access to the database only sees ciphertext that cannot be decrypted without the encryption key held by this service.
- **Backend compromise**: The encryption key never touches the Node.js backend. Compromising the backend does not expose the key material.
- **Ciphertext tampering**: AES-256-GCM's authenticated encryption detects any modification to the ciphertext, IV, or authentication tag.

### What this service does NOT protect against

- **Network-level attacks on the internal network**: Communication between the backend and this service is currently unencrypted (plaintext gRPC). An attacker with access to the internal network could intercept traffic. This is mitigated by network isolation (Docker network, private VPC). mTLS support is planned.
- **Host compromise**: If an attacker gains access to the host running this service, they can read the encryption key from the process environment.
- **Key compromise**: If the encryption key is leaked, all data encrypted with that key version can be decrypted. Use key rotation (`ENCRYPTION_KEYS` with versioned keys) to limit the blast radius.

### Trust boundaries

```
Internet (untrusted)
    │
    ▼
┌──────────────────┐
│  Caddy / TLS     │  ← TLS terminates here
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  keyway-backend  │  ← Handles auth, rate limiting, access control
└──────────────────┘
    │
    ▼  Private network only (Docker network / VPC)
┌──────────────────┐
│  keyway-crypto   │  ← Holds encryption key, never exposed to internet
└──────────────────┘
```

### Deployment requirements

- **MUST** run on an isolated network (Docker internal network, private VPC, Kubernetes pod network)
- **MUST NOT** be exposed to the public internet
- **MUST NOT** have the gRPC port (50051) accessible from outside the private network
- **SHOULD** use mTLS for service-to-service communication in high-security environments
- **SHOULD** use a secrets manager (Kubernetes Secrets, AWS Secrets Manager, etc.) to inject `ENCRYPTION_KEY`

## Cryptographic Details

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM (NIST SP 800-38D) |
| Key size | 256 bits (32 bytes) |
| IV/Nonce | 12 bytes, cryptographically random (`crypto/rand`) |
| Authentication tag | 16 bytes (128 bits) |
| Key rotation | Supported via versioned keys (`ENCRYPTION_KEYS`) |
| Crypto library | Go standard library (`crypto/aes`, `crypto/cipher`, `crypto/rand`) |

The Go standard library crypto packages were [audited by Trail of Bits](https://go.dev/blog/tob-crypto-audit) in 2025.

## What we log (and what we don't)

**Never logged**: plaintext values, ciphertext, IVs, authentication tags, encryption keys.

**Logged**: request sizes (in bytes), key version numbers, operation success/failure status.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Email**: [security@keyway.sh](mailto:security@keyway.sh)
2. **Do NOT** open a public GitHub issue for security vulnerabilities
3. Include a description of the vulnerability and steps to reproduce

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Assessment and timeline**: Within 5 business days
- **Fix and disclosure**: Coordinated with reporter

### What to expect

- We will acknowledge your report promptly
- We will work with you to understand and validate the issue
- We will develop and test a fix
- We will coordinate disclosure timing with you
- We will credit you in the security advisory (unless you prefer anonymity)

## Security Design Decisions

### Why a separate service?

Isolating encryption into a dedicated microservice means:

1. The encryption key is only accessible to this service, not the main backend
2. The attack surface for key extraction is reduced to ~300 lines of Go code
3. The service can be deployed with stricter network policies than the backend
4. Code audits are simpler due to the small, focused codebase

### Why AES-256-GCM?

- NIST-approved and widely adopted across the industry
- Provides both confidentiality and integrity (authenticated encryption)
- Hardware-accelerated on modern CPUs via AES-NI
- Quantum-resistant at the 256-bit level (Grover's algorithm only provides quadratic speedup)

### Why Go standard library?

- Audited by third-party security firms
- Maintained by the Go security team
- No external crypto dependencies = minimal supply chain risk
- CGO disabled = no C memory management vulnerabilities
