import crypto from 'crypto';
import { config } from '../config';

const { algorithm, key: ENCRYPTION_KEY, ivLength: IV_LENGTH, authTagLength: AUTH_TAG_LENGTH } = config.encryption;

/**
 * Current encryption version - increment when changing algorithms
 * Version 1: AES-256-GCM
 */
export const CURRENT_ENCRYPTION_VERSION = 1;

export interface EncryptedData {
  encryptedContent: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts content using AES-256-GCM
 * @param content - The plaintext content to encrypt
 * @returns Object containing encrypted content, IV, and auth tag
 */
export function encrypt(content: string): EncryptedData {
  // Generate random IV for each encryption
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(algorithm, ENCRYPTION_KEY, iv);

  // Encrypt the content
  let encrypted = cipher.update(content, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    encryptedContent: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypts content using AES-256-GCM
 * @param encryptedData - Object containing encrypted content, IV, and auth tag
 * @returns Decrypted plaintext content
 */
export function decrypt(encryptedData: EncryptedData): string {
  const { encryptedContent, iv, authTag } = encryptedData;

  // Create decipher
  const decipher = crypto.createDecipheriv(
    algorithm,
    ENCRYPTION_KEY,
    Buffer.from(iv, 'hex')
  );

  // Set auth tag
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  // Decrypt the content
  let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Sanitizes content for logging - NEVER log actual secret values
 * @param content - Content to sanitize
 * @returns Sanitized representation safe for logging
 */
export function sanitizeForLogging(content: string): string {
  const lines = content.split('\n').length;
  const chars = content.length;
  return `[REDACTED: ${lines} lines, ${chars} characters]`;
}
