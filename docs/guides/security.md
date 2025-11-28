---
sidebar_position: 4
title: Security
---

# Security Model

Keyway is designed with security as a core principle. This guide explains how your secrets are protected.

## Encryption

### At rest

All secrets are encrypted using **AES-256-GCM** before storage:

- 256-bit encryption keys
- Galois/Counter Mode for authenticated encryption
- Random IV (initialization vector) for each encryption
- Encryption happens server-side before database storage

### In transit

All API communication uses **TLS 1.3**:

- HTTPS enforced for all endpoints
- HSTS headers prevent downgrade attacks
- Certificate pinning recommended for high-security environments

## Authentication

### OAuth device flow

The CLI uses OAuth device flow for secure authentication:

1. CLI requests a device code
2. User approves in browser (verifies the code)
3. CLI receives a short-lived token

This flow:
- Never exposes your GitHub password to the CLI
- Requires explicit user approval
- Works in headless environments

### GitHub PAT

For CI/CD, use GitHub Fine-grained Personal Access Tokens:

- Scoped to specific repositories
- Time-limited
- Can be revoked instantly

### Token storage

CLI tokens are stored in:
```
~/.config/keyway/config.json
```

The file has restricted permissions (600) and contains only the encrypted token.

## Authorization

### GitHub-based access

Keyway verifies repository access through the GitHub API:

1. User provides authentication token
2. Keyway calls GitHub API to verify repository access
3. Access level determines allowed operations

This ensures:
- Single source of truth (GitHub)
- Instant access revocation
- No separate user management

### Permission checks

Every API request verifies:
- Token validity
- Repository access level
- Operation permissions

## Infrastructure security

### Database

- PostgreSQL with encrypted connections
- Secrets stored encrypted (never plaintext)
- Regular automated backups
- Point-in-time recovery capability

### API servers

- Deployed on isolated infrastructure
- Regular security updates
- DDoS protection
- Rate limiting

### Key management

- Encryption keys stored in secure key management service
- Keys rotated periodically
- Separate keys per environment

## Best practices

### For developers

1. **Never commit secrets** - Always use `.gitignore`
   ```
   .env
   .env.local
   .env.*.local
   ```

2. **Use environment-specific values** - Don't use production secrets locally

3. **Rotate secrets regularly** - Especially after team changes

4. **Audit access** - Review who has repository access periodically

### For teams

1. **Principle of least privilege** - Give minimum necessary access

2. **Use fine-grained PATs for CI/CD** - Scope to specific repos

3. **Separate production access** - Limit who can access production secrets

4. **Document secret rotation** - Have a process for rotating compromised secrets

### For organizations

1. **Enable SSO** - Use GitHub organization SSO

2. **Review third-party access** - Audit OAuth app permissions

3. **Monitor for anomalies** - Watch for unusual access patterns

4. **Have an incident response plan** - Know what to do if secrets are compromised

## Incident response

### If a secret is compromised

1. **Rotate immediately** - Generate new secret values
2. **Update in Keyway** - Push new values
3. **Deploy changes** - Ensure all systems use new values
4. **Audit access** - Review who had access

### If a token is compromised

1. **Revoke the token** - Log out or revoke PAT
2. **Generate new token** - Re-authenticate
3. **Review access logs** - Check for unauthorized access

## Compliance

Keyway is designed to help teams meet compliance requirements:

- **SOC 2** - Encryption, access controls, audit logging
- **GDPR** - Data encryption, access controls, deletion capability
- **HIPAA** - Encryption at rest and in transit

Contact us for specific compliance documentation.

## Reporting vulnerabilities

If you discover a security vulnerability:

1. **Do not** disclose publicly
2. Email security@keyway.sh
3. Include detailed reproduction steps
4. We'll respond within 24 hours

We appreciate responsible disclosure and offer recognition for valid reports.
