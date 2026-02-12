import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateKeywayToken,
  verifyKeywayToken,
  getTokenExpiresAt,
  type KeywayTokenPayload,
} from '../src/utils/jwt';

describe('JWT Utils (Security Critical)', () => {
  const validPayload: KeywayTokenPayload = {
    userId: 'user-123',
    forgeType: 'github',
    forgeUserId: '12345',
    username: 'testuser',
  };

  describe('generateKeywayToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateKeywayToken(validPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include correct payload in token', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.userId).toBe(validPayload.userId);
      expect(decoded.forgeType).toBe(validPayload.forgeType);
      expect(decoded.forgeUserId).toBe(validPayload.forgeUserId);
      expect(decoded.username).toBe(validPayload.username);
    });

    it('should set correct issuer', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.iss).toBe('keyway-api');
    });

    it('should set subject to userId', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.sub).toBe(validPayload.userId);
    });

    it('should set expiration', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should generate tokens with same content for same payload (deterministic)', () => {
      const token1 = generateKeywayToken(validPayload);
      const token2 = generateKeywayToken(validPayload);

      // JWT tokens with same payload generated in same second will be identical
      // This is expected behavior - uniqueness comes from payload content, not randomness
      const decoded1 = jwt.decode(token1) as jwt.JwtPayload;
      const decoded2 = jwt.decode(token2) as jwt.JwtPayload;

      expect(decoded1.userId).toBe(decoded2.userId);
      expect(decoded1.forgeType).toBe(decoded2.forgeType);
      expect(decoded1.forgeUserId).toBe(decoded2.forgeUserId);
      expect(decoded1.username).toBe(decoded2.username);
    });
  });

  describe('verifyKeywayToken', () => {
    it('should verify and decode a valid token', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = verifyKeywayToken(token);

      expect(decoded.userId).toBe(validPayload.userId);
      expect(decoded.forgeType).toBe(validPayload.forgeType);
      expect(decoded.forgeUserId).toBe(validPayload.forgeUserId);
      expect(decoded.username).toBe(validPayload.username);
    });

    it('should throw "Invalid token" for tampered token', () => {
      const token = generateKeywayToken(validPayload);
      const tamperedToken = token.slice(0, -5) + 'xxxxx';

      expect(() => verifyKeywayToken(tamperedToken)).toThrow('Invalid token');
    });

    it('should throw "Invalid token" for malformed token', () => {
      expect(() => verifyKeywayToken('not-a-token')).toThrow('Invalid token');
      expect(() => verifyKeywayToken('')).toThrow('Invalid token');
      expect(() => verifyKeywayToken('a.b')).toThrow('Invalid token');
    });

    it('should throw "Invalid token" for token with wrong secret', () => {
      // Create token with different secret
      const fakeToken = jwt.sign(validPayload, 'wrong-secret', {
        expiresIn: '1h',
        issuer: 'keyway-api',
        subject: validPayload.userId,
      });

      expect(() => verifyKeywayToken(fakeToken)).toThrow('Invalid token');
    });

    it('should throw "Invalid token" for token with wrong issuer', async () => {
      // Import config to use correct secret but wrong issuer
      const { config } = await import('../src/config');
      const wrongIssuerToken = jwt.sign(validPayload, config.jwt.secret, {
        expiresIn: '1h',
        issuer: 'wrong-issuer',
        subject: validPayload.userId,
      });

      expect(() => verifyKeywayToken(wrongIssuerToken)).toThrow('Invalid token');
    });

    it('should throw "Token expired" for expired token', async () => {
      const { config } = await import('../src/config');
      const expiredToken = jwt.sign(validPayload, config.jwt.secret, {
        expiresIn: '-1s', // Already expired
        issuer: 'keyway-api',
        subject: validPayload.userId,
      });

      expect(() => verifyKeywayToken(expiredToken)).toThrow('Token expired');
    });

    it('should reject null/undefined tokens', () => {
      expect(() => verifyKeywayToken(null as any)).toThrow();
      expect(() => verifyKeywayToken(undefined as any)).toThrow();
    });
  });

  describe('getTokenExpiresAt', () => {
    it('should return expiration date for valid token', () => {
      const token = generateKeywayToken(validPayload);
      const expiresAt = getTokenExpiresAt(token);

      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return correct expiration time', () => {
      const now = Date.now();
      const token = generateKeywayToken(validPayload);
      const expiresAt = getTokenExpiresAt(token);

      // Token expires in ~7 days (config default for access tokens)
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const expectedExpiry = now + sevenDaysMs;

      // Allow 10 second tolerance
      expect(Math.abs(expiresAt.getTime() - expectedExpiry)).toBeLessThan(10000);
    });

    it('should throw for token without expiration', () => {
      // Create unsigned token without exp
      const noExpToken = jwt.sign({ userId: '123' }, 'secret', { noTimestamp: true });

      expect(() => getTokenExpiresAt(noExpToken)).toThrow('Invalid token: no expiration');
    });

    it('should throw for invalid token format', () => {
      expect(() => getTokenExpiresAt('invalid')).toThrow();
    });
  });

  describe('Security scenarios', () => {
    it('should not leak sensitive data in decoded token', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = jwt.decode(token) as any;

      // Should NOT contain password, accessToken, or other sensitive fields
      expect(decoded.password).toBeUndefined();
      expect(decoded.accessToken).toBeUndefined();
      expect(decoded.secret).toBeUndefined();
    });

    it('should properly handle replay attack (same token used twice)', () => {
      const token = generateKeywayToken(validPayload);

      // Both verifications should succeed (stateless JWT)
      const decoded1 = verifyKeywayToken(token);
      const decoded2 = verifyKeywayToken(token);

      expect(decoded1).toEqual(decoded2);
    });

    it('should include iat (issued at) claim', () => {
      const token = generateKeywayToken(validPayload);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.iat).toBeDefined();
      expect(decoded.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    });
  });
});
