/**
 * keyway_list_environments tool
 * Lists available environments for the current repository
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from '../utils/auth.js';
import { getRepository } from '../utils/git.js';
import { getVaultEnvironments } from '../utils/api.js';

export async function listEnvironments(): Promise<CallToolResult> {
  const token = await getToken();
  const repository = getRepository();

  const environments = await getVaultEnvironments(repository, token);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ repository, environments, count: environments.length }, null, 2),
      },
    ],
  };
}
