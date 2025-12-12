/**
 * keyway_set_secret tool
 * Creates or updates a secret in the vault
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { pushSecrets } from '../utils/api.js';

// Validate secret name format
const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export async function setSecret(args: {
  name: string;
  value: string;
  environment?: string;
}): Promise<CallToolResult> {
  // Validate name format
  if (!SECRET_NAME_PATTERN.test(args.name)) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid secret name "${args.name}". Name must be uppercase with underscores (e.g., DATABASE_URL, API_KEY)`,
        },
      ],
      isError: true,
    };
  }

  const token = await getToken();
  const repository = getRepository();
  const environment = args.environment || 'development';

  const result = await pushSecrets(
    repository,
    environment,
    { [args.name]: args.value },
    token
  );

  const action = result.stats?.created ? 'created' : 'updated';

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: true, name: args.name, environment, action }, null, 2),
      },
    ],
  };
}
