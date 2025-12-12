/**
 * keyway_list_secrets tool
 * Lists secret names (keys only, not values) for the current repository
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pullSecrets } from '../utils/api.js';
import { parseEnvContent } from '../utils/env-parser.js';

export async function listSecrets(args: {
  environment?: string;
}): Promise<CallToolResult> {
  const token = await getToken();
  const repository = getRepository();
  const environment = args.environment || 'development';

  const content = await pullSecrets(repository, environment, token);
  const secrets = parseEnvContent(content);
  const keys = Object.keys(secrets).sort();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ repository, environment, count: keys.length, secrets: keys }, null, 2),
      },
    ],
  };
}
