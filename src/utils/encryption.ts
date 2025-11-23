import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

if (!process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required');
}

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
}

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
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

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
    ALGORITHM,
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
