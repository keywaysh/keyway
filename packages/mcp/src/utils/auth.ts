/**
 * Authentication utilities - reads token stored by Keyway CLI
 * Adapted from cli/src/utils/auth.ts
 */

import Conf from 'conf';
import { createDecipheriv } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
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

/**
 * Get the encryption key from ~/.keyway/.key
 * Validates file permissions on Unix systems (should be 0600)
 */
function getEncryptionKey(): Buffer {
  if (!existsSync(KEY_FILE)) {
    throw new Error(`Encryption key not found at ${KEY_FILE}. Run "keyway login" to authenticate.`);
  }

  // Validate file permissions on Unix systems (not Windows)
  if (process.platform !== 'win32') {
    const stats = statSync(KEY_FILE);
    const mode = stats.mode & 0o777;
    // Allow 0600 (owner read/write) or 0400 (owner read only)
    if (mode !== 0o600 && mode !== 0o400) {
      throw new Error(
        `Encryption key file has insecure permissions (${mode.toString(8)}). ` +
          `Expected 0600. Run: chmod 600 ${KEY_FILE}`
      );
    }
  }

  const keyHex = readFileSync(KEY_FILE, 'utf-8').trim();
  if (keyHex.length !== 64) {
    throw new Error(
      `Encryption key file is corrupted (invalid length). ` +
        `Run "keyway logout && keyway login" to reset.`
    );
  }

  return Buffer.from(keyHex, 'hex');
}

function decryptToken(encryptedData: string): string {
  const key = getEncryptionKey(); // Throws if key not found or invalid

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'Stored token format is invalid. Run "keyway logout && keyway login" to reset.'
    );
  }

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error(
      'Failed to decrypt stored token. Run "keyway logout && keyway login" to reset.'
    );
  }
}

function isExpired(auth: StoredAuth): boolean {
  if (!auth.expiresAt) return false;
  const expires = Date.parse(auth.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires <= Date.now();
}

/**
 * Get the stored auth token from CLI config
 * Throws if not logged in, token expired, or decryption fails
 */
export async function getStoredAuth(): Promise<StoredAuth> {
  const encryptedData = store.get('auth');
  if (!encryptedData) {
    throw new Error('Not logged in. Run "keyway login" to authenticate.');
  }

  const decrypted = decryptToken(encryptedData);

  let auth: StoredAuth;
  try {
    auth = JSON.parse(decrypted) as StoredAuth;
  } catch {
    throw new Error('Stored token is corrupted. Run "keyway logout && keyway login" to reset.');
  }

  if (isExpired(auth)) {
    throw new Error('Session expired. Run "keyway login" to re-authenticate.');
  }

  return auth;
}

/**
 * Get the Keyway API token
 * Throws if not authenticated
 */
export async function getToken(): Promise<string> {
  const auth = await getStoredAuth(); // Throws if not authenticated
  return auth.keywayToken;
}
