/**
 * keyway_inject_run tool
 * Runs a command with secrets injected as environment variables
 */

import { spawn } from 'child_process';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pullSecrets } from '../utils/api.js';
import { parseEnvContent } from '../utils/env-parser.js';

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB max output
const TRUNCATION_MESSAGE = '\n\n[Output truncated - exceeded 1MB limit]';

/**
 * Mask secret values in output text
 * Security: Masks all secrets regardless of length, and handles common encodings
 */
function maskSecrets(text: string, secrets: Record<string, string>): string {
  if (!text) return text;

  let masked = text;

  for (const value of Object.values(secrets)) {
    if (!value) continue;

    // Mask the raw value
    masked = masked.replaceAll(value, '***REDACTED***');

    // Also mask common encodings if the value is long enough to be meaningful
    if (value.length >= 4) {
      // URL-encoded version
      try {
        const urlEncoded = encodeURIComponent(value);
        if (urlEncoded !== value) {
          masked = masked.replaceAll(urlEncoded, '***REDACTED***');
        }
      } catch {
        // Ignore encoding errors
      }

      // Base64-encoded version (only for values that look like they could be encoded)
      try {
        const base64Encoded = Buffer.from(value).toString('base64');
        masked = masked.replaceAll(base64Encoded, '***REDACTED***');
      } catch {
        // Ignore encoding errors
      }
    }
  }

  return masked;
}

/**
 * Truncate output if it exceeds the maximum size
 */
function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) {
    return { text, truncated: false };
  }

  // Find a safe truncation point (don't cut in middle of multi-byte char)
  let truncated = text;
  while (Buffer.byteLength(truncated, 'utf8') > maxBytes - Buffer.byteLength(TRUNCATION_MESSAGE, 'utf8')) {
    truncated = truncated.slice(0, -1000); // Remove 1000 chars at a time for efficiency
  }

  return { text: truncated + TRUNCATION_MESSAGE, truncated: true };
}

export async function injectRun(args: {
  command: string;
  args?: string[];
  environment?: string;
  timeout?: number;
}): Promise<CallToolResult> {
  // Validate command is not empty
  if (!args.command || !args.command.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: command is required' }],
      isError: true,
    };
  }

  const token = await getToken();
  const repository = getRepository();
  const environment = args.environment || 'development';
  const timeout = Math.min(args.timeout || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS); // Cap at 5 min

  // Pull secrets
  const content = await pullSecrets(repository, environment, token);
  const secrets = parseEnvContent(content);

  // Merge secrets with current environment
  const env = { ...process.env, ...secrets };

  // Run command with secrets injected
  const result = await new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>((resolve, reject) => {
    const child = spawn(args.command, args.args || [], {
      cwd: process.cwd(),
      env,
      shell: false, // Prevent shell injection
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      // Give process time to cleanup, then force kill
      setTimeout(() => child.kill('SIGKILL'), 5000);
      reject(new Error(`Command timed out after ${timeout / 1000}s`));
    }, timeout);

    child.stdout.on('data', (data: Buffer) => {
      // Limit memory usage by stopping accumulation after max size
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        stdout += data.toString();
        stdoutBytes += data.length;
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        stderr += data.toString();
        stderrBytes += data.length;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      // Truncate and mask output
      const stdoutResult = truncateOutput(stdout, MAX_OUTPUT_BYTES);
      const stderrResult = truncateOutput(stderr, MAX_OUTPUT_BYTES);

      resolve({
        exitCode: code ?? 1,
        stdout: maskSecrets(stdoutResult.text, secrets),
        stderr: maskSecrets(stderrResult.text, secrets),
        stdoutTruncated: stdoutResult.truncated || stdoutBytes >= MAX_OUTPUT_BYTES,
        stderrTruncated: stderrResult.truncated || stderrBytes >= MAX_OUTPUT_BYTES,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to execute command: ${err.message}`));
    });
  });

  const response: Record<string, unknown> = {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    secretsInjected: Object.keys(secrets).length,
  };

  // Include truncation warnings if applicable
  if (result.stdoutTruncated || result.stderrTruncated) {
    response.warnings = [];
    if (result.stdoutTruncated) {
      (response.warnings as string[]).push('stdout was truncated (exceeded 1MB)');
    }
    if (result.stderrTruncated) {
      (response.warnings as string[]).push('stderr was truncated (exceeded 1MB)');
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
    isError: result.exitCode !== 0,
  };
}
