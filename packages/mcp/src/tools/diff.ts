/**
 * keyway_diff tool
 * Compares secrets between two environments
 * Ported from cli/internal/cmd/diff.go
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pullSecrets } from '../utils/api.js';
import { parseEnvContent } from '../utils/env-parser.js';

interface DiffEntry {
  key: string;
  preview1: string;
  preview2: string;
}

interface DiffStats {
  totalEnv1: number;
  totalEnv2: number;
  onlyInEnv1: number;
  onlyInEnv2: number;
  different: number;
  same: number;
}

interface DiffResult {
  env1: string;
  env2: string;
  onlyInEnv1: string[];
  onlyInEnv2: string[];
  different: DiffEntry[];
  same: string[];
  stats: DiffStats;
}

/**
 * Create a safe preview of a secret value
 * Shows last 2 chars + length to help identify changes
 */
function previewValue(value: string): string {
  const length = value.length;
  if (length === 0) {
    return '(empty)';
  }
  if (length <= 2) {
    return `**${value} (${length} chars)`;
  }
  return `**${value.slice(-2)} (${length} chars)`;
}

/**
 * Normalize environment name (dev -> development, prod -> production, etc.)
 */
function normalizeEnvName(env: string): string {
  const normalized = env.toLowerCase().trim();
  switch (normalized) {
    case 'prod':
      return 'production';
    case 'dev':
      return 'development';
    case 'stg':
      return 'staging';
    default:
      return normalized;
  }
}

/**
 * Compare secrets between two environments
 */
function compareSecrets(
  env1: string,
  env2: string,
  secrets1: Record<string, string>,
  secrets2: Record<string, string>
): DiffResult {
  const onlyInEnv1: string[] = [];
  const onlyInEnv2: string[] = [];
  const different: DiffEntry[] = [];
  const same: string[] = [];

  // Get all unique keys
  const allKeys = new Set([...Object.keys(secrets1), ...Object.keys(secrets2)]);
  const sortedKeys = Array.from(allKeys).sort();

  for (const key of sortedKeys) {
    const inEnv1 = key in secrets1;
    const inEnv2 = key in secrets2;
    const val1 = secrets1[key] ?? '';
    const val2 = secrets2[key] ?? '';

    if (inEnv1 && !inEnv2) {
      onlyInEnv1.push(key);
    } else if (!inEnv1 && inEnv2) {
      onlyInEnv2.push(key);
    } else if (val1 !== val2) {
      different.push({
        key,
        preview1: previewValue(val1),
        preview2: previewValue(val2),
      });
    } else {
      same.push(key);
    }
  }

  return {
    env1,
    env2,
    onlyInEnv1,
    onlyInEnv2,
    different,
    same,
    stats: {
      totalEnv1: Object.keys(secrets1).length,
      totalEnv2: Object.keys(secrets2).length,
      onlyInEnv1: onlyInEnv1.length,
      onlyInEnv2: onlyInEnv2.length,
      different: different.length,
      same: same.length,
    },
  };
}

export async function diff(args: { env1: string; env2: string }): Promise<CallToolResult> {
  // Validate inputs
  if (!args.env1 || !args.env2) {
    return {
      content: [{ type: 'text', text: 'Error: Both env1 and env2 are required' }],
      isError: true,
    };
  }

  const env1 = normalizeEnvName(args.env1);
  const env2 = normalizeEnvName(args.env2);

  if (env1 === env2) {
    return {
      content: [{ type: 'text', text: 'Error: Cannot compare an environment with itself' }],
      isError: true,
    };
  }

  const token = await getToken();
  const repository = getRepository();

  // Pull secrets from both environments
  let secrets1: Record<string, string> = {};
  let secrets2: Record<string, string> = {};
  let error1: Error | null = null;
  let error2: Error | null = null;

  try {
    const content1 = await pullSecrets(repository, env1, token);
    secrets1 = parseEnvContent(content1);
  } catch (err) {
    error1 = err as Error;
  }

  try {
    const content2 = await pullSecrets(repository, env2, token);
    secrets2 = parseEnvContent(content2);
  } catch (err) {
    error2 = err as Error;
  }

  // Handle errors
  if (error1 && error2) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: Failed to fetch both environments.\n${env1}: ${error1.message}\n${env2}: ${error2.message}`,
        },
      ],
      isError: true,
    };
  }

  // Compare secrets
  const result = compareSecrets(env1, env2, secrets1, secrets2);

  // Add warnings for empty environments
  const warnings: string[] = [];
  if (error1) {
    warnings.push(`Environment '${env1}' is empty or doesn't exist`);
  }
  if (error2) {
    warnings.push(`Environment '${env2}' is empty or doesn't exist`);
  }

  const response = {
    repository,
    ...result,
    ...(warnings.length > 0 && { warnings }),
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
    isError: false,
  };
}
