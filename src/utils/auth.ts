/**
 * Authentication utilities - reads token stored by Keyway CLI
 * Adapted from cli/src/utils/auth.ts
 */

import Conf from 'conf';
import { createDecipheriv } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface StoredAuth {
  keywayToken: string;
  githubLogin?: string;
  expiresAt?: string;
  createdAt: string;
}

// Same config location as CLI
const store = new Conf<{ auth?: string }>({
  projectName: 'keyway',
  configName: 'config',
});

// Security: Encryption key stored by CLI at ~/.keyway/.key
const KEY_DIR = join(homedir(), '.keyway');
const KEY_FILE = join(KEY_DIR, '.key');

function getEncryptionKey(): Buffer | null {
  if (!existsSync(KEY_FILE)) {
    return null;
  }

  const keyHex = readFileSync(KEY_FILE, 'utf-8').trim();
  if (keyHex.length !== 64) {
    return null;
  }

  return Buffer.from(keyHex, 'hex');
}

function decryptToken(encryptedData: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('Encryption key not found. Run "keyway login" first.');
  }

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function isExpired(auth: StoredAuth): boolean {
  if (!auth.expiresAt) return false;
  const expires = Date.parse(auth.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires <= Date.now();
}

/**
 * Get the stored auth token from CLI config
 * Returns null if not logged in or token is expired
 */
export async function getStoredAuth(): Promise<StoredAuth | null> {
  const encryptedData = store.get('auth');
  if (!encryptedData) {
    return null;
  }

  try {
    const decrypted = decryptToken(encryptedData);
    const auth = JSON.parse(decrypted) as StoredAuth;

    if (isExpired(auth)) {
      return null;
    }

    return auth;
  } catch {
    // Decryption failed - likely wrong key or corrupted data
    return null;
  }
}

/**
 * Get the Keyway API token
 * Throws if not authenticated
 */
export async function getToken(): Promise<string> {
  const auth = await getStoredAuth();
  if (!auth) {
    throw new Error('Not logged in. Run "keyway login" first.');
  }
  return auth.keywayToken;
}
