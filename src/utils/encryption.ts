import { config } from '../config';
import { logger } from './sharedLogger';

/**
 * Default encryption version for backward compatibility
 * Used when decrypting data that doesn't have a version stored
 */
export const DEFAULT_ENCRYPTION_VERSION = 1;

export interface EncryptedData {
  encryptedContent: string;
  iv: string;
  authTag: string;
  /** Key version used for encryption. Defaults to 1 for backward compatibility. */
  version?: number;
}

/**
 * Encryption service interface - async to support remote implementations
 */
export interface IEncryptionService {
  encrypt(content: string): Promise<EncryptedData>;
  decrypt(data: EncryptedData): Promise<string>;
}

// Singleton instance - lazily initialized
let encryptionService: IEncryptionService | null = null;

/**
 * Get the encryption service instance
 * Uses RemoteEncryptionService (Go microservice)
 */
export async function getEncryptionService(): Promise<IEncryptionService> {
  if (!encryptionService) {
    const { RemoteEncryptionService } = await import('./remoteEncryption.js');
    encryptionService = new RemoteEncryptionService(config.crypto.serviceUrl);
    logger.info({ serviceUrl: config.crypto.serviceUrl }, 'Using remote encryption service');
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
