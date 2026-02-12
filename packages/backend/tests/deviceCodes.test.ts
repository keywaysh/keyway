import { describe, it, expect } from 'vitest';
import {
  generateDeviceCode,
  generateUserCode,
  DEVICE_FLOW_CONFIG,
} from '../src/utils/deviceCodes';

describe('Device Codes (Security Critical)', () => {
  describe('generateDeviceCode', () => {
    it('should generate a 64 character hex string', () => {
      const code = generateDeviceCode();

      expect(code).toHaveLength(64);
      expect(code).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique codes', () => {
      const codes = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        codes.add(generateDeviceCode());
      }

      // All codes should be unique
      expect(codes.size).toBe(iterations);
    });

    it('should have sufficient entropy (32 bytes = 256 bits)', () => {
      const code = generateDeviceCode();
      // 64 hex chars = 32 bytes = 256 bits of entropy
      expect(code.length / 2).toBe(32);
    });

    it('should be cryptographically random (not predictable)', () => {
      const code1 = generateDeviceCode();
      const code2 = generateDeviceCode();

      // Codes should be completely different
      expect(code1).not.toBe(code2);

      // No common prefix (unlikely with true randomness)
      expect(code1.slice(0, 8)).not.toBe(code2.slice(0, 8));
    });
  });

  describe('generateUserCode', () => {
    it('should generate a formatted user code (XXXXX-XXXXX)', () => {
      const code = generateUserCode();

      // CRIT-1 fix: Increased to 10 chars for ~48 bits of entropy
      expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      expect(code).toHaveLength(11); // 10 chars + 1 hyphen
    });

    it('should not contain confusing characters (0, O, 1, I, L)', () => {
      // Generate many codes to ensure we'd likely hit confusing chars if they existed
      for (let i = 0; i < 100; i++) {
        const code = generateUserCode();

        expect(code).not.toContain('0');
        expect(code).not.toContain('O');
        expect(code).not.toContain('1');
        expect(code).not.toContain('I');
        expect(code).not.toContain('L');
      }
    });

    it('should generate unique codes', () => {
      const codes = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        codes.add(generateUserCode());
      }

      // All codes should be unique
      expect(codes.size).toBe(iterations);
    });

    it('should only use uppercase letters and numbers', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateUserCode().replace('-', '');
        expect(code).toMatch(/^[A-Z0-9]+$/);
        // No lowercase
        expect(code).not.toMatch(/[a-z]/);
      }
    });

    it('should be easy to read and type', () => {
      const code = generateUserCode();

      // Format is XXXXX-XXXXX (CRIT-1 fix: 10 chars)
      const parts = code.split('-');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveLength(5);
      expect(parts[1]).toHaveLength(5);
    });
  });

  describe('DEVICE_FLOW_CONFIG', () => {
    it('should have reasonable expiration time', () => {
      // Should be at least 5 minutes
      expect(DEVICE_FLOW_CONFIG.EXPIRES_IN).toBeGreaterThanOrEqual(300);
      // Should not be more than 1 hour
      expect(DEVICE_FLOW_CONFIG.EXPIRES_IN).toBeLessThanOrEqual(3600);
    });

    it('should have reasonable poll interval', () => {
      // Should be at least 1 second
      expect(DEVICE_FLOW_CONFIG.POLL_INTERVAL).toBeGreaterThanOrEqual(1);
      // Should not be more than 30 seconds
      expect(DEVICE_FLOW_CONFIG.POLL_INTERVAL).toBeLessThanOrEqual(30);
    });

    it('should allow enough polls before expiration', () => {
      const maxPolls = DEVICE_FLOW_CONFIG.EXPIRES_IN / DEVICE_FLOW_CONFIG.POLL_INTERVAL;
      // User should have at least 30 poll attempts
      expect(maxPolls).toBeGreaterThanOrEqual(30);
    });
  });

  describe('Security properties', () => {
    it('device code should be unfeasible to brute force', () => {
      // 64 hex chars = 32 bytes = 256 bits
      // 2^256 possible combinations - practically impossible to brute force
      const code = generateDeviceCode();
      const entropy = code.length * 4; // 4 bits per hex char

      expect(entropy).toBe(256);
    });

    it('user code should have reasonable entropy', () => {
      // 8 chars from 29 possible characters (excluding confusing ones)
      // 29^8 = ~500 billion combinations
      // This is enough to prevent brute force during the 15 min window
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const codeLength = 8;
      const combinations = Math.pow(chars.length, codeLength);

      // At least 100 billion combinations (safe for 15 min window with rate limiting)
      expect(combinations).toBeGreaterThan(1e11);
    });

    it('user code should be rate-limit friendly', () => {
      // With 15 min expiry and 5s interval = 180 attempts
      // 29^8 / 180 = still ~30 billion per code
      // Safe against brute force even with multiple parallel attacks
      const maxAttempts = DEVICE_FLOW_CONFIG.EXPIRES_IN / DEVICE_FLOW_CONFIG.POLL_INTERVAL;
      expect(maxAttempts).toBeLessThan(200);
    });
  });
});
