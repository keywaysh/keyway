# Security Policy

## Reporting a Vulnerability

We take the security of Keyway seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

### How to Report

Email your findings to: **security@keyway.sh**

Please include the following information in your report:

- Type of vulnerability (e.g., authentication bypass, injection, cryptographic weakness)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours.
- **Communication**: We will keep you informed of the progress toward a fix.
- **Timeline**: We aim to confirm the vulnerability and release a fix within 90 days.
- **Credit**: We will credit you in the security advisory (unless you prefer to remain anonymous).

## Responsible Disclosure

We kindly ask that you:

- Give us reasonable time to address the issue before public disclosure
- Avoid accessing or modifying data that does not belong to you
- Do not exploit the vulnerability beyond what is necessary to demonstrate it
- Do not perform attacks that could harm the reliability or integrity of our services

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Security Best Practices

When self-hosting or contributing to Keyway, please ensure:

### Environment Variables

These environment variables are security-critical:

| Variable | Requirement |
|----------|-------------|
| `JWT_SECRET` | Minimum 32 characters, cryptographically random |
| `GITHUB_APP_WEBHOOK_SECRET` | Required in production for webhook signature verification |
| `GITHUB_APP_PRIVATE_KEY` | Base64-encoded PEM key, keep confidential |
| `DATABASE_URL` | Use SSL connections in production |
| `CRYPTO_SERVICE_URL` | Address of keyway-crypto gRPC service |

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` for CORS (do not leave empty)
- [ ] Enable HTTPS/TLS for all connections
- [ ] Use strong, unique secrets for all credential environment variables
- [ ] Enable database SSL (`?sslmode=require` in connection string)
- [ ] Set up proper firewall rules for the crypto service

## Security Features

Keyway implements the following security measures:

- **Encryption at rest**: All secrets are encrypted with AES-256-GCM before storage
- **Authentication**: GitHub OAuth with JWT tokens; fine-grained API keys
- **Authorization**: Repository access verified via GitHub API on every request
- **Rate limiting**: Global rate limits to prevent abuse
- **Webhook verification**: HMAC-SHA256 signature verification for GitHub and Stripe webhooks
- **Secure randomness**: All tokens use `crypto.randomBytes()` for cryptographic security
- **Input validation**: Zod schemas on all API endpoints
- **Security headers**: Helmet with CSP, HSTS, and other protections

## Scope

The following are in scope for security reports:

- keyway-backend (API server)
- keyway-cli (CLI tool)
- keyway-site (Dashboard and marketing site)
- keyway-action (GitHub Action)
- keyway-docs (Documentation site - limited scope)

### Out of Scope

- Vulnerabilities in third-party dependencies (report to the upstream project)
- Social engineering attacks
- Physical security attacks
- Denial of service attacks
- Issues in environments running unsupported configurations

## Security Advisories

Published security advisories will be available at:
https://github.com/keywaysh/keyway/security/advisories

## Acknowledgments

We thank the following security researchers for their responsible disclosures:

*No reports yet - be the first!*

---

Thank you for helping keep Keyway and our users safe.
