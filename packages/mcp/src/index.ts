/**
 * Keyway MCP Server
 * Provides tools for LLMs to interact with Keyway secrets
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listSecrets } from './tools/list-secrets.js';
import { setSecret } from './tools/set-secret.js';
import { injectRun } from './tools/inject-run.js';
import { listEnvironments } from './tools/list-environments.js';
import { scan } from './tools/scan.js';
import { diff } from './tools/diff.js';
import { generate } from './tools/generate.js';
import { validate } from './tools/validate.js';

const server = new McpServer({
  name: 'keyway-mcp',
  version: '1.0.0',
});

// Register tools
server.tool(
  'keyway_list_secrets',
  'List all secret names in the Keyway vault for the current repository. Returns only the keys, not the values.',
  {
    environment: z
      .string()
      .optional()
      .describe('Environment to list secrets from (default: "development")'),
  },
  async (args) => listSecrets(args)
);

server.tool(
  'keyway_set_secret',
  'Create or update a secret in the Keyway vault. The key must be uppercase with underscores (e.g., DATABASE_URL).',
  {
    name: z.string().describe('Secret name - must be uppercase with underscores'),
    value: z.string().describe('Secret value to store'),
    environment: z
      .string()
      .optional()
      .describe('Environment to set secret in (default: "development")'),
  },
  async (args) => setSecret(args)
);

server.tool(
  'keyway_inject_run',
  'Run a command with Keyway secrets injected as environment variables. Secrets are only available to this command.',
  {
    command: z.string().describe('The command to run (e.g., "npm", "python")'),
    args: z.array(z.string()).optional().describe('Arguments to pass to the command'),
    environment: z
      .string()
      .optional()
      .describe('Environment to pull secrets from (default: "development")'),
    timeout: z
      .number()
      .optional()
      .describe('Timeout in milliseconds (default: 300000 = 5 minutes)'),
  },
  async (args) => injectRun(args)
);

server.tool(
  'keyway_list_environments',
  'List available environments for the current repository vault.',
  {},
  async () => listEnvironments()
);

server.tool(
  'keyway_scan',
  'Scan the codebase for potential secret leaks. Detects AWS keys, GitHub tokens, Stripe keys, private keys, and more.',
  {
    path: z.string().optional().describe('Path to scan (default: current directory)'),
    exclude: z.array(z.string()).optional().describe('Additional directories to exclude'),
  },
  async (args) => scan(args)
);

server.tool(
  'keyway_diff',
  'Compare secrets between two environments to find differences.',
  {
    env1: z.string().describe('First environment (e.g., "development")'),
    env2: z.string().describe('Second environment (e.g., "production")'),
  },
  async (args) => diff(args)
);

server.tool(
  'keyway_generate',
  'Generate a secure secret and store it directly in the vault. The value is never exposed in the conversation.',
  {
    name: z.string().describe('Secret name - must be UPPERCASE_WITH_UNDERSCORES'),
    type: z
      .enum(['password', 'uuid', 'api-key', 'jwt-secret', 'hex', 'base64'])
      .optional()
      .describe('Type of secret to generate (default: "password")'),
    length: z.number().optional().describe('Length of the secret (default: 32, range: 8-256)'),
    environment: z
      .string()
      .optional()
      .describe('Environment to store the secret in (default: "development")'),
  },
  async (args) => generate(args)
);

server.tool(
  'keyway_validate',
  'Validate that required secrets exist in an environment. Useful for pre-deployment checks.',
  {
    environment: z.string().describe('Environment to validate (e.g., "production")'),
    required: z.array(z.string()).optional().describe('List of required secret names to check'),
    autoDetect: z
      .boolean()
      .optional()
      .describe('Auto-detect required secrets from codebase (default: false)'),
    path: z
      .string()
      .optional()
      .describe('Path to scan for auto-detection (default: current directory)'),
  },
  async (args) => validate(args)
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
