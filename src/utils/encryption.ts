import crypto from 'crypto';
import { config } from '../config';

const { algorithm, key: ENCRYPTION_KEY, ivLength: IV_LENGTH } = config.encryption;

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
 * Encryption service interface - async to support remote implementations
 */
export interface IEncryptionService {
  encrypt(content: string): Promise<EncryptedData>;
  decrypt(data: EncryptedData): Promise<string>;
}

/**
 * Local encryption service using AES-256-GCM
 * Can be swapped for a remote implementation (microservice in private VPC)
 */
class LocalEncryptionService implements IEncryptionService {
  async encrypt(content: string): Promise<EncryptedData> {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(algorithm, ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(content, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encryptedContent: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  async decrypt(encryptedData: EncryptedData): Promise<string> {
    const { encryptedContent, iv, authTag } = encryptedData;

    const decipher = crypto.createDecipheriv(
      algorithm,
      ENCRYPTION_KEY,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

// Singleton instance - lazily initialized
let encryptionService: IEncryptionService | null = null;

/**
 * Get the encryption service instance
 * Uses RemoteEncryptionService if CRYPTO_SERVICE_URL is set, otherwise LocalEncryptionService
 */
export async function getEncryptionService(): Promise<IEncryptionService> {
  if (!encryptionService) {
    if (process.env.CRYPTO_SERVICE_URL) {
      const { RemoteEncryptionService } = await import('./remoteEncryption.js');
      encryptionService = new RemoteEncryptionService(process.env.CRYPTO_SERVICE_URL);
      console.log(`Using remote encryption service at ${process.env.CRYPTO_SERVICE_URL}`);
    } else {
      encryptionService = new LocalEncryptionService();
      console.log('Using local encryption service');
    }
  }
  return encryptionService;
}

/**
 * Sanitizes content for logging - NEVER log actual secret values
 */
export function sanitizeForLogging(content: string): string {
  const lines = content.split('\n').length;
  const chars = content.length;
  return `[REDACTED: ${lines} lines, ${chars} characters]`;
}
