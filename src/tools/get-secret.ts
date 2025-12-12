/**
 * keyway_get_secret tool
 * Retrieves a single secret value by name
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pullSecrets } from '../utils/api.js';
import { parseEnvContent } from '../utils/env-parser.js';

export async function getSecret(args: {
  name: string;
  environment?: string;
}): Promise<CallToolResult> {
  const token = await getToken();
  const repository = getRepository();
  const environment = args.environment || 'development';

  const content = await pullSecrets(repository, environment, token);
  const secrets = parseEnvContent(content);

  if (!(args.name in secrets)) {
    return {
      content: [
        {
          type: 'text',
          text: `Secret "${args.name}" not found in environment "${environment}". Available secrets: ${Object.keys(secrets).join(', ') || '(none)'}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ name: args.name, value: secrets[args.name], environment }, null, 2),
      },
    ],
  };
}
