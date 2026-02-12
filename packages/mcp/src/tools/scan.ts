/**
 * keyway_scan tool
 * Scans the codebase for potential secret leaks
 * Ported from cli/internal/cmd/scan.go
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface SecretPattern {
  name: string;
  regex: RegExp;
  description: string;
}

interface Finding {
  file: string;
  line: number;
  type: string;
  preview: string;
}

interface ScanResult {
  filesScanned: number;
  findings: Finding[];
}

// Secret detection patterns (from gitleaks/trufflehog)
const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  {
    name: 'AWS Access Key',
    regex: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/,
    description: 'AWS Access Key ID',
  },
  {
    name: 'AWS Secret Key',
    regex: /(?:aws_secret_access_key|aws_secret)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
    description: 'AWS Secret Access Key',
  },
  // GitHub
  {
    name: 'GitHub PAT',
    regex: /ghp_[0-9a-zA-Z]{36}/,
    description: 'GitHub Personal Access Token',
  },
  {
    name: 'GitHub PAT (fine-grained)',
    regex: /github_pat_[0-9a-zA-Z_]{82}/,
    description: 'GitHub Fine-Grained Personal Access Token',
  },
  {
    name: 'GitHub OAuth',
    regex: /gho_[0-9a-zA-Z]{36}/,
    description: 'GitHub OAuth Token',
  },
  {
    name: 'GitHub App Token',
    regex: /ghu_[0-9a-zA-Z]{36}/,
    description: 'GitHub App User Token',
  },
  {
    name: 'GitHub Refresh Token',
    regex: /ghr_[0-9a-zA-Z]{36}/,
    description: 'GitHub Refresh Token',
  },
  // GitLab
  {
    name: 'GitLab Token',
    regex: /glpat-[0-9a-zA-Z_-]{20,}/,
    description: 'GitLab Personal Access Token',
  },
  // Stripe
  {
    name: 'Stripe Secret Key',
    regex: /sk_live_[0-9a-zA-Z]{24,}/,
    description: 'Stripe Live Secret Key',
  },
  {
    name: 'Stripe Publishable Key',
    regex: /pk_live_[0-9a-zA-Z]{24,}/,
    description: 'Stripe Live Publishable Key',
  },
  {
    name: 'Stripe Restricted Key',
    regex: /rk_live_[0-9a-zA-Z]{24,}/,
    description: 'Stripe Live Restricted Key',
  },
  // Private Keys
  {
    name: 'Private Key',
    regex: /-----BEGIN\s+(RSA|EC|OPENSSH|DSA|PGP|ENCRYPTED)?\s*PRIVATE KEY-----/,
    description: 'Private Key Header',
  },
  // Slack
  {
    name: 'Slack Webhook',
    regex:
      /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{24}/,
    description: 'Slack Webhook URL',
  },
  {
    name: 'Slack Token',
    regex: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/,
    description: 'Slack API Token',
  },
  // Twilio
  {
    name: 'Twilio API Key',
    regex: /SK[0-9a-fA-F]{32}/,
    description: 'Twilio API Key',
  },
  // SendGrid
  {
    name: 'SendGrid API Key',
    regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/,
    description: 'SendGrid API Key',
  },
  // npm
  {
    name: 'npm Token',
    regex: /npm_[a-zA-Z0-9]{36}/,
    description: 'npm Access Token',
  },
  // Heroku
  {
    name: 'Heroku API Key',
    regex:
      /heroku[a-z_-]*[=:\s]+['"]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]?/i,
    description: 'Heroku API Key',
  },
  // Google
  {
    name: 'Google API Key',
    regex: /AIza[0-9A-Za-z_-]{35}/,
    description: 'Google API Key',
  },
  // Discord
  {
    name: 'Discord Token',
    regex: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/,
    description: 'Discord Bot Token',
  },
  {
    name: 'Discord Webhook',
    regex: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]{17,20}\/[A-Za-z0-9_-]{60,68}/,
    description: 'Discord Webhook URL',
  },
  // Generic patterns (more prone to false positives)
  {
    name: 'Generic API Key',
    regex: /['"]?api[_-]?key['"]?\s*[=:]\s*['"]([a-zA-Z0-9_-]{20,})['"]/i,
    description: 'Generic API Key assignment',
  },
  {
    name: 'Generic Secret',
    regex: /['"]?(?:secret|password|passwd|pwd)['"]?\s*[=:]\s*['"]([^'"]{8,})['"]/i,
    description: 'Generic secret assignment',
  },
];

// Directories to exclude by default
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
  '.pnpm',
];

// Binary file extensions to skip
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.svg',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  '.mov',
  '.webm',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.jar',
  '.class',
  '.pyc',
  '.pyo',
  '.lock',
  '.lockb',
]);

// Placeholder values that indicate false positives
const PLACEHOLDERS = [
  'xxx',
  'your',
  'example',
  'placeholder',
  'changeme',
  'insert',
  'replace',
  'todo',
  'fixme',
  'dummy',
  'test',
  'fake',
  'mock',
  'sample',
  'demo',
  '<your',
  '${',
  '{{',
  'env[',
  'process.env',
];

/**
 * Mask a secret value, showing only first 4 and last 3 characters
 */
function maskSecret(secret: string): string {
  if (secret.length <= 10) {
    return '*'.repeat(secret.length);
  }
  return secret.slice(0, 4) + '*'.repeat(secret.length - 7) + secret.slice(-3);
}

/**
 * Check if a match is likely a false positive
 */
function isFalsePositive(match: string, line: string, filePath: string): boolean {
  const lowerLine = line.toLowerCase();
  const lowerMatch = match.toLowerCase();
  const lowerPath = filePath.toLowerCase();

  // Skip test/example files
  if (
    lowerPath.includes('test') ||
    lowerPath.includes('spec') ||
    lowerPath.includes('example') ||
    lowerPath.includes('mock') ||
    lowerPath.includes('fixture') ||
    lowerPath.includes('.example') ||
    lowerPath.includes('.sample')
  ) {
    return true;
  }

  // Skip placeholder values
  for (const placeholder of PLACEHOLDERS) {
    if (lowerMatch.includes(placeholder) || lowerLine.includes(placeholder)) {
      return true;
    }
  }

  // Skip variable references
  if (
    line.includes('${') ||
    line.includes('$(') ||
    line.includes('process.env') ||
    line.includes('os.getenv') ||
    line.includes('ENV[')
  ) {
    return true;
  }

  // Skip documentation patterns
  if (
    lowerLine.includes('example:') ||
    lowerLine.includes('e.g.') ||
    lowerLine.includes('for example')
  ) {
    return true;
  }

  return false;
}

/**
 * Scan a single file for secrets
 */
function scanFile(filePath: string, relPath: string): Finding[] {
  const findings: Finding[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return findings; // Skip files we can't read
  }

  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      continue;
    }

    // Check each pattern
    for (const pattern of SECRET_PATTERNS) {
      const matches = line.match(pattern.regex);
      if (matches) {
        const match = matches[0];

        // Skip false positives
        if (isFalsePositive(match, line, relPath)) {
          continue;
        }

        findings.push({
          file: relPath,
          line: lineNum + 1,
          type: pattern.name,
          preview: maskSecret(match),
        });
      }
    }
  }

  return findings;
}

/**
 * Recursively scan a directory for secrets
 */
function scanDirectory(
  rootPath: string,
  excludes: string[],
  currentPath: string = rootPath
): ScanResult {
  let filesScanned = 0;
  const findings: Finding[] = [];

  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return { filesScanned, findings };
  }

  for (const entry of entries) {
    const fullPath = join(currentPath, entry);
    const relPath = relative(rootPath, fullPath);

    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue; // Skip files we can't access
    }

    if (stats.isDirectory()) {
      // Skip excluded directories
      if (excludes.includes(entry) || excludes.some((e) => relPath.startsWith(e))) {
        continue;
      }

      // Recurse into subdirectory
      const subResult = scanDirectory(rootPath, excludes, fullPath);
      filesScanned += subResult.filesScanned;
      findings.push(...subResult.findings);
    } else if (stats.isFile()) {
      // Skip binary files
      const ext = extname(entry).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        continue;
      }

      // Skip large files (> 1MB)
      if (stats.size > 1024 * 1024) {
        continue;
      }

      // Scan file
      const fileFindings = scanFile(fullPath, relPath);
      filesScanned++;
      findings.push(...fileFindings);
    }
  }

  return { filesScanned, findings };
}

export async function scan(args: { path?: string; exclude?: string[] }): Promise<CallToolResult> {
  const scanPath = args.path || process.cwd();
  const excludes = [...DEFAULT_EXCLUDES, ...(args.exclude || [])];

  // Validate path exists
  try {
    const stats = statSync(scanPath);
    if (!stats.isDirectory()) {
      return {
        content: [{ type: 'text', text: `Error: ${scanPath} is not a directory` }],
        isError: true,
      };
    }
  } catch {
    return {
      content: [{ type: 'text', text: `Error: Path does not exist: ${scanPath}` }],
      isError: true,
    };
  }

  // Perform scan
  const result = scanDirectory(scanPath, excludes);

  const response = {
    path: scanPath,
    filesScanned: result.filesScanned,
    findingsCount: result.findings.length,
    findings: result.findings,
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
