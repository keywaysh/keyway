import { describe, it, expect } from 'vitest';
import { generatePreview } from '../src/services/secret.service';

describe('Secret Service', () => {
  describe('generatePreview', () => {
    it('should return all dots for values <= 8 characters', () => {
      expect(generatePreview('')).toBe('••••••••');
      expect(generatePreview('a')).toBe('••••••••');
      expect(generatePreview('ab')).toBe('••••••••');
      expect(generatePreview('abcdefgh')).toBe('••••••••');
    });

    it('should return first 2 + dots + last 2 for values 9-12 characters', () => {
      expect(generatePreview('123456789')).toBe('12••••89');
      expect(generatePreview('abcdefghij')).toBe('ab••••ij');
      expect(generatePreview('abcdefghijk')).toBe('ab••••jk');
      expect(generatePreview('abcdefghijkl')).toBe('ab••••kl');
    });

    it('should return first 4 + dots + last 4 for values > 12 characters', () => {
      expect(generatePreview('abcdefghijklm')).toBe('abcd••••jklm');
      // 43 chars, last 4 = '2/db'
      expect(generatePreview('postgres://user:password@localhost:5432/db')).toBe('post••••2/db');
      expect(generatePreview('sk_live_1234567890abcdef')).toBe('sk_l••••cdef');
    });

    it('should handle special characters correctly', () => {
      expect(generatePreview('!@#$%^&*()_+=')).toBe('!@#$••••)_+=');
      // 'unicode: ñ日本' is 13 chars (ñ and 日本 are multi-byte but single chars)
      // Actually the string is 12 characters so it uses the 9-12 rule
      expect(generatePreview('unicode: ñ日本')).toBe('un••••日本');
    });

    it('should handle base64 encoded secrets', () => {
      const base64Secret = 'dGhpc19pc19hX3NlY3JldF9rZXk=';
      expect(generatePreview(base64Secret)).toBe('dGhp••••ZXk=');
    });

    it('should handle JWT-like tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      // 115 chars, last 4 = 'sR8U'
      expect(generatePreview(jwt)).toBe('eyJh••••sR8U');
    });

    it('should never reveal more than 8 characters total', () => {
      // Short values: all masked
      expect(generatePreview('short').length).toBe(8);

      // Medium values: 2 + 4 dots + 2 = 8
      expect(generatePreview('mediumvalue').length).toBe(8);

      // Long values: 4 + 4 dots + 4 = 12
      expect(generatePreview('this is a very long secret value')).toHaveLength(12);
    });
  });
});
