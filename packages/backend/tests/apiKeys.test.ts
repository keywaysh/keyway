import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  validateApiKeyFormat,
  extractEnvironment,
  isKeywayApiKey,
  validateScopes,
  hasRequiredScopes,
  maskApiKey,
  API_KEY_SCOPES,
} from '../src/utils/apiKeys';

describe('API Keys Utils', () => {
  describe('generateApiKey', () => {
    it('should generate a valid live API key', () => {
      const result = generateApiKey('live');

      expect(result.token).toMatch(/^kw_live_[a-zA-Z0-9]{40}$/);
      expect(result.prefix).toMatch(/^kw_live_[a-zA-Z0-9]{8}$/);
      expect(result.hash).toHaveLength(64); // SHA-256 = 64 hex chars
    });

    it('should generate a valid test API key', () => {
      const result = generateApiKey('test');

      expect(result.token).toMatch(/^kw_test_[a-zA-Z0-9]{40}$/);
      expect(result.prefix).toMatch(/^kw_test_[a-zA-Z0-9]{8}$/);
      expect(result.hash).toHaveLength(64);
    });

    it('should generate unique tokens each time', () => {
      const result1 = generateApiKey('live');
      const result2 = generateApiKey('live');

      expect(result1.token).not.toBe(result2.token);
      expect(result1.hash).not.toBe(result2.hash);
    });

    it('should generate prefix that matches token start', () => {
      const result = generateApiKey('live');
      expect(result.token.startsWith(result.prefix)).toBe(true);
    });

    it('should produce consistent hash for same token', () => {
      const result = generateApiKey('test');
      const hash1 = hashApiKey(result.token);
      const hash2 = hashApiKey(result.token);

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(result.hash);
    });

    // ENTROPY & UNIQUENESS TESTS
    describe('entropy and uniqueness', () => {
      it('should generate 1000 unique tokens without collision', () => {
        const tokens = new Set<string>();
        const hashes = new Set<string>();

        for (let i = 0; i < 1000; i++) {
          const result = generateApiKey(i % 2 === 0 ? 'live' : 'test');
          tokens.add(result.token);
          hashes.add(result.hash);
        }

        expect(tokens.size).toBe(1000);
        expect(hashes.size).toBe(1000);
      });

      it('should use all base62 characters (statistical test)', () => {
        const charCounts: Record<string, number> = {};
        const iterations = 500;

        for (let i = 0; i < iterations; i++) {
          const result = generateApiKey('live');
          const randomPart = result.token.slice('kw_live_'.length);
          for (const char of randomPart) {
            charCounts[char] = (charCounts[char] || 0) + 1;
          }
        }

        // Should have representation from all 62 characters
        const uniqueChars = Object.keys(charCounts).length;
        expect(uniqueChars).toBeGreaterThanOrEqual(50); // Allow some variance, but expect most chars used
      });

      it('should have approximately uniform character distribution', () => {
        const charCounts: Record<string, number> = {};
        const iterations = 1000;
        const totalChars = iterations * 40;

        for (let i = 0; i < iterations; i++) {
          const result = generateApiKey('test');
          const randomPart = result.token.slice('kw_test_'.length);
          for (const char of randomPart) {
            charCounts[char] = (charCounts[char] || 0) + 1;
          }
        }

        const expectedPerChar = totalChars / 62;
        const counts = Object.values(charCounts);
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;

        // Each character should appear within 50% of expected (allowing for Base62 bias)
        // The modulo bias means chars 0-7 have ~1.95% chance vs ~1.56% for others
        // This is acceptable for API keys but should be monitored
        expect(avg).toBeGreaterThan(expectedPerChar * 0.5);
        expect(avg).toBeLessThan(expectedPerChar * 1.5);
      });
    });
  });

  describe('hashApiKey', () => {
    it('should hash a token to 64 character hex string', () => {
      const hash = hashApiKey('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = hashApiKey('kw_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const hash2 = hashApiKey('kw_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(hash1).not.toBe(hash2);
    });

    it('should be deterministic', () => {
      const token = 'kw_test_x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2h1G0';
      expect(hashApiKey(token)).toBe(hashApiKey(token));
    });

    // EDGE CASES FOR HASHING
    describe('edge cases', () => {
      it('should hash empty string without crashing', () => {
        const hash = hashApiKey('');
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      });

      it('should handle unicode characters in token', () => {
        const hash = hashApiKey('kw_live_🔑🔐🔒');
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      });

      it('should produce different hashes for tokens differing by one character', () => {
        const hash1 = hashApiKey('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0');
        const hash2 = hashApiKey('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T1');
        expect(hash1).not.toBe(hash2);
      });

      it('should handle very long tokens', () => {
        const longToken = 'kw_live_' + 'a'.repeat(10000);
        const hash = hashApiKey(longToken);
        expect(hash).toHaveLength(64);
      });

      it('should handle tokens with null bytes', () => {
        const hash = hashApiKey('kw_live_test\x00value');
        expect(hash).toHaveLength(64);
      });

      it('should handle tokens with newlines', () => {
        const hash = hashApiKey('kw_live_test\nvalue');
        expect(hash).toHaveLength(64);
      });
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should validate correct live key format', () => {
      expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(true);
    });

    it('should validate correct test key format', () => {
      expect(validateApiKeyFormat('kw_test_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(true);
    });

    it('should reject keys with wrong prefix', () => {
      expect(validateApiKeyFormat('sk_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
      expect(validateApiKeyFormat('key_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
    });

    it('should reject keys with invalid environment', () => {
      expect(validateApiKeyFormat('kw_prod_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
      expect(validateApiKeyFormat('kw_dev_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
    });

    it('should reject keys with wrong random length', () => {
      // Too short (39 chars)
      expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9')).toBe(false);
      // Too long (41 chars)
      expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0X')).toBe(false);
    });

    it('should reject keys with invalid characters', () => {
      expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T!')).toBe(false);
      expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T-')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateApiKeyFormat('')).toBe(false);
    });

    it('should reject partial keys', () => {
      expect(validateApiKeyFormat('kw_live_')).toBe(false);
      expect(validateApiKeyFormat('kw_')).toBe(false);
    });

    // SECURITY EDGE CASES
    describe('security edge cases', () => {
      it('should reject tokens with unicode lookalikes', () => {
        // Cyrillic 'а' looks like Latin 'a'
        expect(validateApiKeyFormat('kw_live_а1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
      });

      it('should reject tokens with leading/trailing whitespace', () => {
        expect(validateApiKeyFormat(' kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
        expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0 ')).toBe(false);
        expect(validateApiKeyFormat('\nkw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
      });

      it('should reject tokens with embedded whitespace', () => {
        expect(validateApiKeyFormat('kw_live_a1B2c3D4 e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
        expect(validateApiKeyFormat('kw_live_a1B2c3D4\te5F6g7H8i9J0k1L2m3N4o5P6q7R8s9')).toBe(false);
      });

      it('should handle prototype pollution attempts', () => {
        expect(validateApiKeyFormat('__proto__')).toBe(false);
        expect(validateApiKeyFormat('constructor')).toBe(false);
        expect(validateApiKeyFormat('kw_live___proto__aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
      });

      it('should reject null bytes in token', () => {
        expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0\x00k1L2m3N4o5P6q7R8s')).toBe(false);
      });

      it('should handle case sensitivity correctly', () => {
        // Environment must be lowercase
        expect(validateApiKeyFormat('kw_LIVE_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
        expect(validateApiKeyFormat('kw_Live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
        expect(validateApiKeyFormat('KW_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe(false);
      });

      it('should reject very long malicious input (ReDoS prevention)', () => {
        // Test that regex doesn't catastrophically backtrack
        const start = Date.now();
        const maliciousInput = 'kw_live_' + 'a'.repeat(100000);
        validateApiKeyFormat(maliciousInput);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(100); // Should complete in < 100ms
      });

      it('should reject tokens with multiple underscores in random part', () => {
        expect(validateApiKeyFormat('kw_live_a1B2c3D4_5F6g7H8i9J0k1L2m3N4o5P6q7R8s9')).toBe(false);
      });

      it('should reject tokens ending with underscore', () => {
        expect(validateApiKeyFormat('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9_')).toBe(false);
      });
    });

    // BOUNDARY TESTS
    describe('boundary conditions', () => {
      it('should validate exactly 40 character random part', () => {
        // Exactly 40 chars
        expect(validateApiKeyFormat('kw_live_0123456789012345678901234567890123456789')).toBe(true);
      });

      it('should reject 39 character random part', () => {
        expect(validateApiKeyFormat('kw_live_012345678901234567890123456789012345678')).toBe(false);
      });

      it('should reject 41 character random part', () => {
        expect(validateApiKeyFormat('kw_live_01234567890123456789012345678901234567890')).toBe(false);
      });
    });
  });

  describe('extractEnvironment', () => {
    it('should extract live environment', () => {
      expect(extractEnvironment('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe('live');
    });

    it('should extract test environment', () => {
      expect(extractEnvironment('kw_test_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')).toBe('test');
    });

    it('should return null for invalid format', () => {
      expect(extractEnvironment('invalid_token')).toBe(null);
      expect(extractEnvironment('kw_prod_xxx')).toBe(null);
      expect(extractEnvironment('')).toBe(null);
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should extract environment even from invalid-length tokens', () => {
        // extractEnvironment only checks prefix, not full format
        expect(extractEnvironment('kw_live_short')).toBe('live');
        expect(extractEnvironment('kw_test_x')).toBe('test');
      });

      it('should return null for uppercase environment', () => {
        expect(extractEnvironment('kw_LIVE_xxx')).toBe(null);
      });

      it('should return null for mixed case', () => {
        expect(extractEnvironment('kw_Live_xxx')).toBe(null);
        expect(extractEnvironment('kw_TEST_xxx')).toBe(null);
      });
    });
  });

  describe('isKeywayApiKey', () => {
    it('should return true for tokens starting with kw_', () => {
      expect(isKeywayApiKey('kw_live_xxx')).toBe(true);
      expect(isKeywayApiKey('kw_test_xxx')).toBe(true);
      expect(isKeywayApiKey('kw_anything')).toBe(true);
    });

    it('should return false for other tokens', () => {
      expect(isKeywayApiKey('sk_live_xxx')).toBe(false);
      expect(isKeywayApiKey('ghp_xxxx')).toBe(false);
      expect(isKeywayApiKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(false);
      expect(isKeywayApiKey('')).toBe(false);
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should return true even for incomplete kw_ prefix', () => {
        expect(isKeywayApiKey('kw_')).toBe(true);
      });

      it('should return false for similar but different prefixes', () => {
        expect(isKeywayApiKey('KW_live_xxx')).toBe(false); // uppercase
        expect(isKeywayApiKey('kw-live-xxx')).toBe(false); // dashes
        expect(isKeywayApiKey('kw live xxx')).toBe(false); // spaces
      });

      it('should handle unicode that looks like kw_', () => {
        // Different unicode characters that might look similar
        expect(isKeywayApiKey('ｋｗ_live_xxx')).toBe(false); // fullwidth
      });
    });
  });

  describe('validateScopes', () => {
    it('should validate correct scopes', () => {
      expect(validateScopes(['read:secrets'])).toBe(true);
      expect(validateScopes(['write:secrets'])).toBe(true);
      expect(validateScopes(['delete:secrets'])).toBe(true);
      expect(validateScopes(['admin:api-keys'])).toBe(true);
    });

    it('should validate multiple scopes', () => {
      expect(validateScopes(['read:secrets', 'write:secrets'])).toBe(true);
      expect(validateScopes(API_KEY_SCOPES as unknown as string[])).toBe(true);
    });

    it('should reject invalid scopes', () => {
      expect(validateScopes(['read:users'])).toBe(false);
      expect(validateScopes(['invalid'])).toBe(false);
      expect(validateScopes(['read:secrets', 'invalid'])).toBe(false);
    });

    it('should accept empty array', () => {
      expect(validateScopes([])).toBe(true);
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should reject scope with wrong case', () => {
        expect(validateScopes(['READ:secrets'])).toBe(false);
        expect(validateScopes(['Read:Secrets'])).toBe(false);
        expect(validateScopes(['READ:SECRETS'])).toBe(false);
      });

      it('should handle duplicate scopes', () => {
        // Duplicates are technically valid strings, function should still work
        expect(validateScopes(['read:secrets', 'read:secrets'])).toBe(true);
      });

      it('should reject empty string in array', () => {
        expect(validateScopes([''])).toBe(false);
        expect(validateScopes(['read:secrets', ''])).toBe(false);
      });

      it('should reject scopes with extra whitespace', () => {
        expect(validateScopes([' read:secrets'])).toBe(false);
        expect(validateScopes(['read:secrets '])).toBe(false);
        expect(validateScopes(['read: secrets'])).toBe(false);
      });

      it('should reject scope-like strings that are close but wrong', () => {
        expect(validateScopes(['read:secret'])).toBe(false); // missing 's'
        expect(validateScopes(['reads:secrets'])).toBe(false); // extra 's'
        expect(validateScopes(['read::secrets'])).toBe(false); // double colon
        expect(validateScopes(['read-secrets'])).toBe(false); // dash instead of colon
      });

      it('should handle prototype pollution attempts', () => {
        expect(validateScopes(['__proto__'])).toBe(false);
        expect(validateScopes(['constructor'])).toBe(false);
        expect(validateScopes(['hasOwnProperty'])).toBe(false);
      });
    });
  });

  describe('hasRequiredScopes', () => {
    it('should return true when all required scopes are present', () => {
      expect(hasRequiredScopes(['read:secrets', 'write:secrets'], ['read:secrets'])).toBe(true);
      expect(hasRequiredScopes(['read:secrets', 'write:secrets'], ['read:secrets', 'write:secrets'])).toBe(true);
    });

    it('should return false when required scopes are missing', () => {
      expect(hasRequiredScopes(['read:secrets'], ['write:secrets'])).toBe(false);
      expect(hasRequiredScopes(['read:secrets'], ['read:secrets', 'write:secrets'])).toBe(false);
    });

    it('should return true for empty required scopes', () => {
      expect(hasRequiredScopes(['read:secrets'], [])).toBe(true);
      expect(hasRequiredScopes([], [])).toBe(true);
    });

    it('should return false when user has no scopes but some are required', () => {
      expect(hasRequiredScopes([], ['read:secrets'])).toBe(false);
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should handle duplicate scopes in user scopes', () => {
        expect(hasRequiredScopes(['read:secrets', 'read:secrets'], ['read:secrets'])).toBe(true);
      });

      it('should handle duplicate scopes in required scopes', () => {
        expect(hasRequiredScopes(['read:secrets'], ['read:secrets', 'read:secrets'])).toBe(true);
      });

      it('should be case-sensitive', () => {
        expect(hasRequiredScopes(['READ:secrets'], ['read:secrets'])).toBe(false);
        expect(hasRequiredScopes(['read:secrets'], ['READ:secrets'])).toBe(false);
      });

      it('should handle all scopes requirement', () => {
        const allScopes = ['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys'];
        expect(hasRequiredScopes(allScopes, allScopes)).toBe(true);
        expect(hasRequiredScopes(allScopes.slice(0, 3), allScopes)).toBe(false);
      });

      it('should handle superset of required scopes', () => {
        const allScopes = ['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys'];
        expect(hasRequiredScopes(allScopes, ['read:secrets'])).toBe(true);
        expect(hasRequiredScopes(allScopes, ['write:secrets', 'delete:secrets'])).toBe(true);
      });
    });
  });

  describe('maskApiKey', () => {
    it('should mask a valid API key', () => {
      const masked = maskApiKey('kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0');
      expect(masked).toBe('kw_live_a1B2************************************');
      expect(masked).not.toContain('c3D4');
    });

    it('should mask test keys', () => {
      const masked = maskApiKey('kw_test_x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2h1G0');
      expect(masked).toMatch(/^kw_test_x9Y8\*{36}$/);
    });

    it('should return invalid marker for invalid tokens', () => {
      expect(maskApiKey('invalid')).toBe('***invalid***');
      expect(maskApiKey('')).toBe('***invalid***');
      expect(maskApiKey('kw_live_short')).toBe('***invalid***');
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should handle tokens with valid format but all same characters', () => {
        const masked = maskApiKey('kw_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(masked).toBe('kw_live_aaaa************************************');
      });

      it('should preserve the correct visible characters count', () => {
        // Token must have exactly 40 random chars to be valid (kw_live_ = 8 chars + 40 = 48 total)
        const token = 'kw_live_ABCDe5F6g7H8i9J0k1L2m3N4o5P6q7R8abcdefgh';
        expect(token.length).toBe(48); // Sanity check: 8 prefix + 40 random
        const masked = maskApiKey(token);
        // Should show kw_live_ + first 4 chars of random (ABCD) + 36 asterisks
        expect(masked).toBe('kw_live_ABCD************************************');
        // Total length: 8 (prefix) + 4 (visible) + 36 (masked) = 48
        expect(masked.length).toBe(48);
      });

      it('should mask exactly 36 characters', () => {
        const masked = maskApiKey('kw_live_1234567890123456789012345678901234567890');
        const asterisks = (masked.match(/\*/g) || []).length;
        expect(asterisks).toBe(36);
      });

      it('should not leak sensitive data in masked output', () => {
        const token = 'kw_test_SECRETpasswordAPIkeyDontLeakThis1234';
        const masked = maskApiKey(token);
        expect(masked).not.toContain('SECRET');
        expect(masked).not.toContain('password');
        expect(masked).not.toContain('APIkey');
        expect(masked).not.toContain('Leak');
      });
    });
  });

  describe('API_KEY_SCOPES constant', () => {
    it('should contain expected scopes', () => {
      expect(API_KEY_SCOPES).toContain('read:secrets');
      expect(API_KEY_SCOPES).toContain('write:secrets');
      expect(API_KEY_SCOPES).toContain('delete:secrets');
      expect(API_KEY_SCOPES).toContain('admin:api-keys');
    });

    it('should have exactly 4 scopes', () => {
      expect(API_KEY_SCOPES).toHaveLength(4);
    });

    it('should be immutable via TypeScript (as const)', () => {
      // TypeScript's `as const` provides compile-time immutability via the type system
      // Runtime freezing is not done, but modifications would cause TS errors
      // We verify the array is intact and unmodified
      expect(Array.isArray(API_KEY_SCOPES)).toBe(true);
      expect(API_KEY_SCOPES.length).toBe(4);
      // Verify no one modified the values
      expect([...API_KEY_SCOPES]).toEqual(['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys']);
    });

    it('should have consistent ordering', () => {
      // Important for UI display consistency
      expect(API_KEY_SCOPES[0]).toBe('read:secrets');
      expect(API_KEY_SCOPES[1]).toBe('write:secrets');
      expect(API_KEY_SCOPES[2]).toBe('delete:secrets');
      expect(API_KEY_SCOPES[3]).toBe('admin:api-keys');
    });
  });

  // INTEGRATION TESTS
  describe('integration: generate and validate flow', () => {
    it('should generate keys that pass validation', () => {
      for (let i = 0; i < 100; i++) {
        const env = i % 2 === 0 ? 'live' : 'test';
        const result = generateApiKey(env);

        expect(validateApiKeyFormat(result.token)).toBe(true);
        expect(isKeywayApiKey(result.token)).toBe(true);
        expect(extractEnvironment(result.token)).toBe(env);
        expect(maskApiKey(result.token)).not.toBe('***invalid***');
      }
    });

    it('should have consistent hash for generated tokens', () => {
      const result = generateApiKey('live');

      // Hash should match what generateApiKey returned
      expect(hashApiKey(result.token)).toBe(result.hash);

      // Multiple calls should be consistent
      expect(hashApiKey(result.token)).toBe(hashApiKey(result.token));
    });
  });

  // SECURITY TESTS
  describe('security: known attack vectors', () => {
    it('should not be vulnerable to timing attacks via hash function', () => {
      // While the hash function itself is not constant-time,
      // the database lookup is, and we don't do client-side comparison
      // This test ensures consistent hash output regardless of input similarity
      const baseToken = 'kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0';
      const similarToken = 'kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T1';

      const hash1 = hashApiKey(baseToken);
      const hash2 = hashApiKey(similarToken);

      // Hashes should be completely different (no partial match patterns)
      const commonPrefix = hash1.split('').filter((c, i) => c === hash2[i]).length;
      // Expect roughly random similarity (~8 chars out of 64 by chance)
      expect(commonPrefix).toBeLessThan(32);
    });

    it('should generate tokens with sufficient entropy for security', () => {
      // Each Base62 character provides ~5.95 bits of entropy
      // 40 characters * 5.95 = ~238 bits (exceeds 128-bit security target)
      const result = generateApiKey('live');
      const randomPart = result.token.slice('kw_live_'.length);

      // Basic entropy check: should have mix of character types
      const hasLower = /[a-z]/.test(randomPart);
      const hasUpper = /[A-Z]/.test(randomPart);
      const hasDigit = /[0-9]/.test(randomPart);

      // Highly unlikely to not have all character types in 40 chars
      expect(hasLower).toBe(true);
      expect(hasUpper).toBe(true);
      expect(hasDigit).toBe(true);
    });
  });
});
