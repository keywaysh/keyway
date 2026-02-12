/**
 * keyway_generate tool
 * Generates secure secrets and stores them directly in the vault
 * The secret value is never exposed to the AI conversation
 */

import { randomBytes, randomUUID } from 'crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pushSecrets, pullSecrets } from '../utils/api.js';
import { parseEnvContent } from '../utils/env-parser.js';

type SecretType = 'password' | 'uuid' | 'api-key' | 'jwt-secret' | 'hex' | 'base64';

interface GenerateArgs {
  name: string;
  type?: SecretType;
  length?: number;
  environment?: string;
}

// Character sets for password generation
const CHARSET_ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CHARSET_NUMERIC = '0123456789';
const CHARSET_SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const CHARSET_ALPHANUMERIC = CHARSET_ALPHA + CHARSET_NUMERIC;

/**
 * Generate a cryptographically secure random string from a charset
 */
function randomString(length: number, charset: string): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  return result;
}

/**
 * Generate a secure password with mixed characters
 */
function generatePassword(length: number): string {
  // Ensure at least one of each type
  const minLength = 12;
  const actualLength = Math.max(length, minLength);

  // Generate base password
  const charset = CHARSET_ALPHANUMERIC + CHARSET_SPECIAL;
  const password = randomString(actualLength, charset);

  // Ensure complexity requirements
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password);

  // If missing any, regenerate (rare case)
  if (!hasLower || !hasUpper || !hasNumber || !hasSpecial) {
    return generatePassword(length);
  }

  return password;
}

/**
 * Generate a secret based on type
 */
function generateSecret(type: SecretType, length: number): string {
  switch (type) {
    case 'password':
      return generatePassword(length);

    case 'uuid':
      return randomUUID();

    case 'api-key':
      // Format: prefix_base62 (like sk_live_xxx or key_xxx)
      return `key_${randomString(length, CHARSET_ALPHANUMERIC)}`;

    case 'jwt-secret': {
      // 256-bit minimum for HS256
      const jwtLength = Math.max(length, 32);
      return randomBytes(jwtLength).toString('base64url');
    }

    case 'hex':
      return randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length);

    case 'base64':
      return randomBytes(Math.ceil((length * 3) / 4))
        .toString('base64')
        .slice(0, length);

    default:
      return generatePassword(length);
  }
}

/**
 * Mask a secret for safe display
 */
function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
}

/**
 * Validate secret name format
 */
function isValidSecretName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

export async function generate(args: GenerateArgs): Promise<CallToolResult> {
  const { name, type = 'password', length = 32, environment = 'development' } = args;

  // Validate name
  if (!name) {
    return {
      content: [{ type: 'text', text: 'Error: Secret name is required' }],
      isError: true,
    };
  }

  if (!isValidSecretName(name)) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: Invalid secret name "${name}". Must be UPPERCASE_WITH_UNDERSCORES (e.g., DATABASE_URL, API_KEY)`,
        },
      ],
      isError: true,
    };
  }

  // Validate type
  const validTypes: SecretType[] = ['password', 'uuid', 'api-key', 'jwt-secret', 'hex', 'base64'];
  if (!validTypes.includes(type)) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: Invalid type "${type}". Valid types: ${validTypes.join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  // Validate length
  if (length < 8 || length > 256) {
    return {
      content: [{ type: 'text', text: 'Error: Length must be between 8 and 256' }],
      isError: true,
    };
  }

  try {
    const token = await getToken();
    const repository = getRepository();

    // Generate the secret value
    const secretValue = generateSecret(type, length);

    // Pull existing secrets
    let existingSecrets: Record<string, string> = {};
    try {
      const content = await pullSecrets(repository, environment, token);
      existingSecrets = parseEnvContent(content);
    } catch {
      // Environment might not exist yet, that's OK
    }

    // Check if secret already exists
    const isUpdate = name in existingSecrets;

    // Add/update the secret
    existingSecrets[name] = secretValue;

    // Push to vault (API expects Record<string, string>)
    await pushSecrets(repository, environment, existingSecrets, token);

    const response = {
      success: true,
      action: isUpdate ? 'updated' : 'created',
      name,
      type,
      length: secretValue.length,
      preview: maskSecret(secretValue),
      environment,
      repository,
      message: `Secret "${name}" ${isUpdate ? 'updated' : 'created'} with a secure ${type} value. The actual value is stored in Keyway and was never exposed in this conversation.`,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error generating secret: ${message}` }],
      isError: true,
    };
  }
}
