/**
 * keyway_validate tool
 * Validates that required secrets exist in an environment
 * Useful for pre-deployment checks
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pullSecrets } from '../utils/api.js';
import { parseEnvContent } from '../utils/env-parser.js';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

interface ValidateArgs {
  environment: string;
  required?: string[];
  autoDetect?: boolean;
  path?: string;
}

interface ValidationResult {
  valid: boolean;
  environment: string;
  repository: string;
  required: string[];
  missing: string[];
  present: string[];
  extra: string[];
  stats: {
    requiredCount: number;
    presentCount: number;
    missingCount: number;
    coverage: string;
  };
}

// Common env var patterns by framework/library
const FRAMEWORK_PATTERNS: Record<string, RegExp> = {
  // Node.js patterns
  'process.env.': /process\.env\.([A-Z][A-Z0-9_]*)/g,
  'process.env[]': /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,

  // Vite/import.meta
  'import.meta.env.': /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,

  // Next.js
  NEXT_PUBLIC: /NEXT_PUBLIC_[A-Z0-9_]+/g,

  // Python
  'os.getenv': /os\.getenv\(['"]([A-Z][A-Z0-9_]*)['"]/g,
  'os.environ': /os\.environ\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  'os.environ.get': /os\.environ\.get\(['"]([A-Z][A-Z0-9_]*)['"]/g,

  // Ruby
  ENV: /ENV\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,

  // Go
  'os.Getenv': /os\.Getenv\(['"]([A-Z][A-Z0-9_]*)['"]\)/g,

  // Rust
  'env::var': /env::var\(['"]([A-Z][A-Z0-9_]*)['"]\)/g,

  // Generic dotenv
  dotenv: /\$\{([A-Z][A-Z0-9_]*)\}/g,
};

// Directories to skip when scanning
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'coverage',
]);

// File extensions to scan
const SCAN_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.vue',
  '.svelte',
]);

/**
 * Scan a file for environment variable references
 */
function scanFileForEnvVars(filePath: string): Set<string> {
  const envVars = new Set<string>();

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return envVars;
  }

  for (const pattern of Object.values(FRAMEWORK_PATTERNS)) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Get the captured group (env var name)
      const envVar = match[1] || match[0];
      if (/^[A-Z][A-Z0-9_]*$/.test(envVar)) {
        envVars.add(envVar);
      }
    }
  }

  return envVars;
}

/**
 * Recursively scan directory for environment variable references
 */
function scanDirectoryForEnvVars(dirPath: string, maxDepth: number = 5): Set<string> {
  const envVars = new Set<string>();

  function scan(currentPath: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);

      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (!SKIP_DIRS.has(entry) && !entry.startsWith('.')) {
          scan(fullPath, depth + 1);
        }
      } else if (stats.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          const fileVars = scanFileForEnvVars(fullPath);
          fileVars.forEach((v) => envVars.add(v));
        }
      }
    }
  }

  scan(dirPath, 0);
  return envVars;
}

/**
 * Filter out common non-secret env vars
 */
function filterNonSecrets(envVars: Set<string>): string[] {
  const nonSecrets = new Set([
    'NODE_ENV',
    'PORT',
    'HOST',
    'DEBUG',
    'LOG_LEVEL',
    'TZ',
    'LANG',
    'HOME',
    'PATH',
    'PWD',
    'SHELL',
    'USER',
    'TERM',
    'CI',
    'GITHUB_ACTIONS',
    'VERCEL',
    'NETLIFY',
  ]);

  return Array.from(envVars)
    .filter((v) => !nonSecrets.has(v))
    .sort();
}

export async function validate(args: ValidateArgs): Promise<CallToolResult> {
  const { environment, required = [], autoDetect = false, path = process.cwd() } = args;

  if (!environment) {
    return {
      content: [{ type: 'text', text: 'Error: Environment is required' }],
      isError: true,
    };
  }

  try {
    const token = await getToken();
    const repository = getRepository();

    // Get required secrets list
    let requiredSecrets: string[] = [...required];

    // Auto-detect from codebase if requested
    if (autoDetect) {
      const detected = scanDirectoryForEnvVars(path);
      const filtered = filterNonSecrets(detected);
      requiredSecrets = [...new Set([...requiredSecrets, ...filtered])];
    }

    if (requiredSecrets.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No required secrets specified. Provide a "required" array or set "autoDetect: true"',
          },
        ],
        isError: true,
      };
    }

    // Pull existing secrets
    let existingSecrets: Record<string, string> = {};
    try {
      const content = await pullSecrets(repository, environment, token);
      existingSecrets = parseEnvContent(content);
    } catch {
      // Environment might not exist
    }

    const existingKeys = new Set(Object.keys(existingSecrets));

    // Categorize secrets
    const missing: string[] = [];
    const present: string[] = [];

    for (const secret of requiredSecrets) {
      if (existingKeys.has(secret)) {
        present.push(secret);
      } else {
        missing.push(secret);
      }
    }

    // Find extra secrets (in vault but not required)
    const requiredSet = new Set(requiredSecrets);
    const extra = Array.from(existingKeys)
      .filter((k) => !requiredSet.has(k))
      .sort();

    const coverage =
      requiredSecrets.length > 0
        ? ((present.length / requiredSecrets.length) * 100).toFixed(1)
        : '100.0';

    const result: ValidationResult = {
      valid: missing.length === 0,
      environment,
      repository,
      required: requiredSecrets.sort(),
      missing: missing.sort(),
      present: present.sort(),
      extra,
      stats: {
        requiredCount: requiredSecrets.length,
        presentCount: present.length,
        missingCount: missing.length,
        coverage: `${coverage}%`,
      },
    };

    // Add helpful message
    let message: string;
    if (result.valid) {
      message = `✓ All ${requiredSecrets.length} required secrets are present in "${environment}"`;
    } else {
      message = `✗ Missing ${missing.length} required secret${missing.length > 1 ? 's' : ''} in "${environment}": ${missing.join(', ')}`;
    }

    const response = {
      ...result,
      message,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error validating secrets: ${errorMessage}` }],
      isError: true,
    };
  }
}
