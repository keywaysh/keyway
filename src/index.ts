/**
 * Keyway MCP Server
 * Provides tools for LLMs to interact with Keyway secrets
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listSecrets } from './tools/list-secrets.js';
import { getSecret } from './tools/get-secret.js';
import { setSecret } from './tools/set-secret.js';
import { injectRun } from './tools/inject-run.js';
import { listEnvironments } from './tools/list-environments.js';

const server = new McpServer({
  name: 'keyway-mcp',
  version: '1.0.0',
});

// Register tools
server.tool(
  'keyway_list_secrets',
  'List all secret names in the Keyway vault for the current repository. Returns only the keys, not the values.',
  {
    environment: z.string().optional().describe('Environment to list secrets from (default: "development")'),
  },
  async (args) => listSecrets(args)
);

server.tool(
  'keyway_get_secret',
  'Get the value of a specific secret from the Keyway vault. Use this when you need the actual secret value.',
  {
    name: z.string().describe('The name/key of the secret to retrieve (e.g., "DATABASE_URL")'),
    environment: z.string().optional().describe('Environment to get secret from (default: "development")'),
  },
  async (args) => getSecret(args)
);

server.tool(
  'keyway_set_secret',
  'Create or update a secret in the Keyway vault. The key must be uppercase with underscores (e.g., DATABASE_URL).',
  {
    name: z.string().describe('Secret name - must be uppercase with underscores'),
    value: z.string().describe('Secret value to store'),
    environment: z.string().optional().describe('Environment to set secret in (default: "development")'),
  },
  async (args) => setSecret(args)
);

server.tool(
  'keyway_inject_run',
  'Run a command with Keyway secrets injected as environment variables. Secrets are only available to this command.',
  {
    command: z.string().describe('The command to run (e.g., "npm", "python")'),
    args: z.array(z.string()).optional().describe('Arguments to pass to the command'),
    environment: z.string().optional().describe('Environment to pull secrets from (default: "development")'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 300000 = 5 minutes)'),
  },
  async (args) => injectRun(args)
);

server.tool(
  'keyway_list_environments',
  'List available environments for the current repository vault.',
  {},
  async () => listEnvironments()
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
