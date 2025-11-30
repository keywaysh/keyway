import { describe, it, expect, beforeAll, vi } from 'vitest';
import { getEncryptionService, sanitizeForLogging, type EncryptedData } from '../src/utils/encryption';

// Mock the remote encryption service for unit tests
// This tests the encryption interface without requiring the gRPC service
vi.mock('../src/utils/remoteEncryption', () => {
  const crypto = require('crypto');

  // Use a test key for encryption
  const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

  class MockEncryptionService {
    async encrypt(content: string): Promise<{ encryptedContent: string; iv: string; authTag: string }> {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', TEST_KEY, iv);

      let encrypted = cipher.update(content, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();

      return {
        encryptedContent: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
      };
    }

    async decrypt(data: { encryptedContent: string; iv: string; authTag: string }): Promise<string> {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        TEST_KEY,
        Buffer.from(data.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));

      let decrypted = decipher.update(data.encryptedContent, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
  }

  return {
    RemoteEncryptionService: MockEncryptionService,
  };
});

describe('Encryption Utils', () => {
  describe('encrypt', () => {
    it('should encrypt content and return encrypted data', async () => {
      const service = await getEncryptionService();
      const content = 'my-secret-value';
      const result = await service.encrypt(content);

      expect(result).toHaveProperty('encryptedContent');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('authTag');
      expect(result.encryptedContent).not.toBe(content);
      expect(result.iv).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(result.authTag).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    it('should produce different IVs for same content', async () => {
      const service = await getEncryptionService();
      const content = 'same-content';
      const result1 = await service.encrypt(content);
      const result2 = await service.encrypt(content);

      expect(result1.iv).not.toBe(result2.iv);
      expect(result1.encryptedContent).not.toBe(result2.encryptedContent);
    });

    it('should handle empty strings', async () => {
      const service = await getEncryptionService();
      const result = await service.encrypt('');
      expect(result.encryptedContent).toBeDefined();
    });

    it('should handle unicode content', async () => {
      const service = await getEncryptionService();
      const content = 'Hello 世界 🔐';
      const result = await service.encrypt(content);
      expect(result.encryptedContent).toBeDefined();
    });

    it('should handle multiline content', async () => {
      const service = await getEncryptionService();
      const content = 'DATABASE_URL=postgres://...\nAPI_KEY=secret123\nDEBUG=true';
      const result = await service.encrypt(content);
      expect(result.encryptedContent).toBeDefined();
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted content back to original', async () => {
      const service = await getEncryptionService();
      const original = 'my-secret-value';
      const encrypted = await service.encrypt(original);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should handle empty strings', async () => {
      const service = await getEncryptionService();
      const original = '';
      const encrypted = await service.encrypt(original);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should handle unicode content', async () => {
      const service = await getEncryptionService();
      const original = 'Hello 世界 🔐';
      const encrypted = await service.encrypt(original);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should handle multiline .env content', async () => {
      const service = await getEncryptionService();
      const original = `DATABASE_URL=postgres://user:pass@host:5432/db
API_KEY=sk-1234567890
DEBUG=true
MULTILINE="line1
line2"`;
      const encrypted = await service.encrypt(original);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should fail with tampered encrypted content', async () => {
      const service = await getEncryptionService();
      const encrypted = await service.encrypt('secret');
      encrypted.encryptedContent = 'tampered' + encrypted.encryptedContent;

      await expect(service.decrypt(encrypted)).rejects.toThrow();
    });

    it('should fail with tampered auth tag', async () => {
      const service = await getEncryptionService();
      const encrypted = await service.encrypt('secret');
      encrypted.authTag = '00000000000000000000000000000000';

      await expect(service.decrypt(encrypted)).rejects.toThrow();
    });

    it('should fail with wrong IV', async () => {
      const service = await getEncryptionService();
      const encrypted = await service.encrypt('secret');
      encrypted.iv = '00000000000000000000000000000000';

      await expect(service.decrypt(encrypted)).rejects.toThrow();
    });
  });

  describe('sanitizeForLogging', () => {
    it('should return redacted string with line and char count', () => {
      const content = 'single line';
      const result = sanitizeForLogging(content);

      expect(result).toBe('[REDACTED: 1 lines, 11 characters]');
    });

    it('should count multiple lines correctly', () => {
      const content = 'line1\nline2\nline3';
      const result = sanitizeForLogging(content);

      expect(result).toContain('3 lines');
    });

    it('should not expose actual content', () => {
      const content = 'super-secret-api-key-123';
      const result = sanitizeForLogging(content);

      expect(result).not.toContain('super');
      expect(result).not.toContain('secret');
      expect(result).not.toContain('api');
      expect(result).not.toContain('key');
      expect(result).not.toContain('123');
    });

    it('should handle empty string', () => {
      const result = sanitizeForLogging('');
      expect(result).toBe('[REDACTED: 1 lines, 0 characters]');
    });
  });
});
