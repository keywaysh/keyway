# Security

Keyway is a secrets management platform. We treat security as a core feature, not an afterthought.

Your secrets deserve the same protection used by banks and healthcare providers. That's exactly what we built.

## How We Protect Your Secrets

### Encryption at Rest

Every secret stored in Keyway is encrypted using **AES-256-GCM**, the same standard used by governments and financial institutions worldwide. Each encryption operation uses a unique initialization vector (IV), ensuring that even identical values produce different ciphertexts.

Your GitHub access tokens are also encrypted in our database—never stored in plaintext.

### Encryption in Transit

All communications use **TLS 1.3**. The CLI enforces HTTPS and will refuse to connect over insecure channels. No exceptions.

### Authentication

We leverage GitHub's battle-tested OAuth infrastructure. Your GitHub credentials never touch our servers. We use signed state parameters to prevent CSRF attacks, and our JWT tokens use explicit algorithm specifications to prevent token forgery.

### Access Control

Keyway inherits GitHub's permission model. If you can push to a repo, you can access its secrets. If you can't, you can't. Simple, auditable, and familiar.

### Rate Limiting & Abuse Prevention

Sensitive endpoints are protected against brute-force attacks with strict rate limiting.

## What We Protect Against

| Threat | Protection |
|--------|------------|
| Database breach | AES-256-GCM encryption at rest |
| Man-in-the-middle | TLS 1.3, HTTPS enforced |
| Token forgery | Signed JWTs with explicit algorithms |
| CSRF attacks | Signed OAuth state parameters |
| XSS | Content Security Policy, HttpOnly cookies |
| Brute force | Rate limiting on all auth endpoints |
| Credential stuffing | GitHub OAuth (no passwords) |

## Security Practices

- **No plaintext secrets** in logs, errors, or stack traces
- **Minimal data retention** — we only store what's necessary
- **Regular security audits** of our codebase
- **Dependency monitoring** for known vulnerabilities

## Reporting a Vulnerability

Found a security issue? We want to hear from you.

**Email:** security@keyway.sh

Please do not open public GitHub issues for security vulnerabilities.

We will:
- Acknowledge receipt within 48 hours
- Provide a detailed response within 7 days
- Credit you in our security advisories (if desired)

### Bug Bounty

We reward security researchers who help us keep Keyway safe. Bounties are awarded based on severity and impact. Contact us at security@keyway.sh for details.

## For Contributors

If you're contributing to Keyway, please follow these guidelines:

- Never log tokens, secrets, or credentials
- Validate and sanitize all user inputs
- Use parameterized queries for database operations
- Set restrictive file permissions (0600) for sensitive files
- Test error paths for information leakage
- When in doubt, ask for a security review
