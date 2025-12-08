/**
 * Railway Provider Implementation
 * Handles API token auth and GraphQL API for Railway
 *
 * Railway uses API tokens (Team or Account) instead of OAuth.
 * GraphQL endpoint: https://backboard.railway.com/graphql/v2
 */

import {
  Provider,
  TokenResponse,
  ProviderProject,
  ProviderEnvVar,
  ProviderUser,
  registerProvider,
} from './base.provider';

const RAILWAY_API_BASE = 'https://backboard.railway.com/graphql/v2';
const DEFAULT_TIMEOUT_MS = 30000;

// Logger for provider operations
const logger = {
  error: (context: Record<string, unknown>, message: string) => {
    const sanitized = sanitizeLogContext(context);
    console.error(`[RailwayProvider] ${message}`, JSON.stringify(sanitized, null, 2));
  },
  warn: (context: Record<string, unknown>, message: string) => {
    const sanitized = sanitizeLogContext(context);
    console.warn(`[RailwayProvider] ${message}`, JSON.stringify(sanitized, null, 2));
  },
};

function sanitizeLogContext(context: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['token', 'accessToken', 'refreshToken', 'secret', 'password', 'authorization'];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 100) {
      result[key] = value.substring(0, 50) + '...[truncated]';
    } else {
      result[key] = value;
    }
  }

  return result;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
    };
  }>;
}

export class RailwayProviderError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'RailwayProviderError';
  }
}

async function railwayGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(RAILWAY_API_BASE, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RailwayProviderError(
        `Rate limited by Railway API. Retry after ${retryAfter || 'a few'} seconds.`,
        'rate_limited',
        429
      );
    }

    let data: GraphQLResponse<T>;
    try {
      data = await response.json() as GraphQLResponse<T>;
    } catch {
      throw new RailwayProviderError(
        `Railway API returned invalid response: ${response.status} ${response.statusText}`,
        'invalid_response',
        response.status
      );
    }

    if (data.errors && data.errors.length > 0) {
      const error = data.errors[0];
      throw new RailwayProviderError(
        error.message,
        error.extensions?.code,
        response.status
      );
    }

    if (!data.data) {
      throw new RailwayProviderError(
        'Railway API returned empty response',
        'empty_response',
        response.status
      );
    }

    return data.data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RailwayProviderError(
        `Request to Railway API timed out after ${timeoutMs / 1000}s`,
        'timeout',
        0
      );
    }
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new RailwayProviderError(
        'Network error connecting to Railway API. Check your internet connection.',
        'network_error',
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// GraphQL Queries
const QUERIES = {
  me: `
    query {
      me {
        id
        email
        name
        teams {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  `,

  // Direct projects query - works with both Account and Team tokens
  projects: `
    query {
      projects {
        edges {
          node {
            id
            name
            createdAt
            services {
              edges {
                node {
                  id
                  name
                  repoTriggers {
                    edges {
                      node {
                        repository
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,

  project: `
    query($projectId: String!) {
      project(id: $projectId) {
        id
        name
        createdAt
        environments {
          edges {
            node {
              id
              name
            }
          }
        }
        services {
          edges {
            node {
              id
              name
              repoTriggers {
                edges {
                  node {
                    repository
                  }
                }
              }
            }
          }
        }
      }
    }
  `,

  // Get shared variables (no serviceId)
  sharedVariables: `
    query($projectId: String!, $environmentId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId) {
        key
        value
      }
    }
  `,

  // Get service variables (with serviceId)
  serviceVariables: `
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        key
        value
      }
    }
  `,
};

const MUTATIONS = {
  upsertVariable: `
    mutation($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `,

  deleteVariable: `
    mutation($input: VariableDeleteInput!) {
      variableDelete(input: $input)
    }
  `,
};

export const railwayProvider: Provider = {
  name: 'railway',
  displayName: 'Railway',

  // Railway doesn't use OAuth - token is provided directly by user
  // These methods are required by interface but won't be used for Railway
  getAuthorizationUrl(_state: string, _redirectUri: string): { url: string; codeVerifier?: string } {
    // Railway uses direct token auth, not OAuth
    throw new RailwayProviderError(
      'Railway uses API token authentication, not OAuth',
      'not_supported'
    );
  },

  async exchangeCodeForToken(_code: string, _redirectUri: string, _codeVerifier?: string): Promise<TokenResponse> {
    // Railway uses direct token auth, not OAuth
    throw new RailwayProviderError(
      'Railway uses API token authentication, not OAuth',
      'not_supported'
    );
  },

  async getUser(accessToken: string): Promise<ProviderUser> {
    interface MeResponse {
      me: {
        id: string;
        email: string;
        name?: string;
        teams?: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      };
    }

    // Try the `me` query first (works for Account Tokens)
    try {
      const data = await railwayGraphQL<MeResponse>(QUERIES.me, {}, accessToken);

      // Get the first team if any
      const team = data.me.teams?.edges?.[0]?.node;

      return {
        id: data.me.id,
        username: data.me.name || data.me.email.split('@')[0],
        email: data.me.email,
        teamId: team?.id,
        teamName: team?.name,
      };
    } catch (meError) {
      // If `me` fails, try validating via `projects` query (works for Team Tokens)
      // Team tokens can access projects but not personal info
      interface ProjectsValidationResponse {
        projects: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      }

      try {
        const projectsData = await railwayGraphQL<ProjectsValidationResponse>(
          `query { projects { edges { node { id name } } } }`,
          {},
          accessToken
        );

        // Token is valid if we can access projects
        // Use a hash of the token as a stable identifier
        const tokenHash = accessToken.slice(0, 8);

        return {
          id: `railway-team-${tokenHash}`,
          username: `Railway Team (${projectsData.projects.edges.length} projects)`,
          email: undefined,
          teamId: undefined,
          teamName: undefined,
        };
      } catch {
        // Both queries failed - token is truly invalid
        throw meError;
      }
    }
  },

  async listProjects(accessToken: string, _teamId?: string): Promise<ProviderProject[]> {
    interface ProjectsResponse {
      projects: {
        edges: Array<{
          node: {
            id: string;
            name: string;
            createdAt: string;
            services?: {
              edges: Array<{
                node: {
                  id: string;
                  name: string;
                  repoTriggers?: {
                    edges: Array<{
                      node: {
                        repository: string;
                      };
                    }>;
                  };
                };
              }>;
            };
          };
        }>;
      };
    }

    const data = await railwayGraphQL<ProjectsResponse>(QUERIES.projects, {}, accessToken);

    return data.projects.edges.map(({ node: p }) => {
      // Try to find a linked GitHub repo from services
      let linkedRepo: string | undefined;
      for (const service of p.services?.edges || []) {
        const repo = service.node.repoTriggers?.edges?.[0]?.node?.repository;
        if (repo) {
          linkedRepo = repo;
          break;
        }
      }

      return {
        id: p.id,
        name: p.name,
        linkedRepo,
        createdAt: new Date(p.createdAt),
      };
    });
  },

  async getProject(accessToken: string, projectId: string, _teamId?: string): Promise<ProviderProject | null> {
    interface ProjectResponse {
      project: {
        id: string;
        name: string;
        createdAt: string;
        environments?: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
        services?: {
          edges: Array<{
            node: {
              id: string;
              name: string;
              repoTriggers?: {
                edges: Array<{
                  node: {
                    repository: string;
                  };
                }>;
              };
            };
          }>;
        };
      };
    }

    try {
      const data = await railwayGraphQL<ProjectResponse>(
        QUERIES.project,
        { projectId },
        accessToken
      );

      // Try to find a linked GitHub repo
      let linkedRepo: string | undefined;
      for (const service of data.project.services?.edges || []) {
        const repo = service.node.repoTriggers?.edges?.[0]?.node?.repository;
        if (repo) {
          linkedRepo = repo;
          break;
        }
      }

      return {
        id: data.project.id,
        name: data.project.name,
        linkedRepo,
        createdAt: new Date(data.project.createdAt),
      };
    } catch (error) {
      if (error instanceof RailwayProviderError && error.code === 'NOT_FOUND') {
        return null;
      }
      throw error;
    }
  },

  async listEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    _teamId?: string
  ): Promise<ProviderEnvVar[]> {
    // Parse environment format: "production" or "production:serviceId"
    const [envName, serviceId] = environment.split(':');

    // First, get the environment ID from the project
    interface ProjectEnvsResponse {
      project: {
        environments: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      };
    }

    const projectData = await railwayGraphQL<ProjectEnvsResponse>(
      QUERIES.project,
      { projectId },
      accessToken
    );

    const envNode = projectData.project.environments.edges.find(
      e => e.node.name.toLowerCase() === envName.toLowerCase()
    );

    if (!envNode) {
      // Return empty if environment not found
      return [];
    }

    const environmentId = envNode.node.id;

    // Get variables (shared or service-specific)
    interface VariablesResponse {
      variables: Array<{
        key: string;
        value: string;
      }>;
    }

    let data: VariablesResponse;
    if (serviceId) {
      data = await railwayGraphQL<VariablesResponse>(
        QUERIES.serviceVariables,
        { projectId, environmentId, serviceId },
        accessToken
      );
    } else {
      data = await railwayGraphQL<VariablesResponse>(
        QUERIES.sharedVariables,
        { projectId, environmentId },
        accessToken
      );
    }

    return data.variables.map(v => ({
      key: v.key,
      value: v.value,
    }));
  },

  async setEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    vars: Record<string, string>,
    _teamId?: string
  ): Promise<{ created: number; updated: number; failed: number; failedKeys: string[] }> {
    // Parse environment format: "production" or "production:serviceId"
    const [envName, serviceId] = environment.split(':');

    // Get environment ID
    interface ProjectEnvsResponse {
      project: {
        environments: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      };
    }

    const projectData = await railwayGraphQL<ProjectEnvsResponse>(
      QUERIES.project,
      { projectId },
      accessToken
    );

    const envNode = projectData.project.environments.edges.find(
      e => e.node.name.toLowerCase() === envName.toLowerCase()
    );

    if (!envNode) {
      throw new RailwayProviderError(
        `Environment "${envName}" not found in project`,
        'environment_not_found'
      );
    }

    const environmentId = envNode.node.id;

    // Get existing variables to determine create vs update
    const existingVars = await this.listEnvVars(accessToken, projectId, environment);
    const existingKeys = new Set(existingVars.map(v => v.key));

    let created = 0;
    let updated = 0;
    let failed = 0;
    const failedKeys: string[] = [];

    for (const [key, value] of Object.entries(vars)) {
      try {
        const input: Record<string, string> = {
          projectId,
          environmentId,
          name: key,
          value,
        };

        if (serviceId) {
          input.serviceId = serviceId;
        }

        await railwayGraphQL(MUTATIONS.upsertVariable, { input }, accessToken);

        if (existingKeys.has(key)) {
          updated++;
        } else {
          created++;
        }
      } catch (error) {
        failed++;
        failedKeys.push(key);
        logger.error(
          { key, projectId, environment, error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to set env var'
        );
      }
    }

    if (failed > 0 && created === 0 && updated === 0) {
      throw new RailwayProviderError(
        `Failed to set all ${failed} environment variables`,
        'all_operations_failed'
      );
    }

    return { created, updated, failed, failedKeys };
  },

  async deleteEnvVar(
    accessToken: string,
    projectId: string,
    environment: string,
    key: string,
    _teamId?: string
  ): Promise<void> {
    // Parse environment format
    const [envName, serviceId] = environment.split(':');

    // Get environment ID
    interface ProjectEnvsResponse {
      project: {
        environments: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      };
    }

    const projectData = await railwayGraphQL<ProjectEnvsResponse>(
      QUERIES.project,
      { projectId },
      accessToken
    );

    const envNode = projectData.project.environments.edges.find(
      e => e.node.name.toLowerCase() === envName.toLowerCase()
    );

    if (!envNode) {
      return; // Environment not found, nothing to delete
    }

    const environmentId = envNode.node.id;

    const input: Record<string, string> = {
      projectId,
      environmentId,
      name: key,
    };

    if (serviceId) {
      input.serviceId = serviceId;
    }

    await railwayGraphQL(MUTATIONS.deleteVariable, { input }, accessToken);
  },

  async deleteEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    keys: string[],
    _teamId?: string
  ): Promise<{ deleted: number; failed: number; failedKeys: string[] }> {
    let deleted = 0;
    let failed = 0;
    const failedKeys: string[] = [];

    for (const key of keys) {
      try {
        await this.deleteEnvVar(accessToken, projectId, environment, key, _teamId);
        deleted++;
      } catch (error) {
        failed++;
        failedKeys.push(key);
        logger.error(
          { key, projectId, environment, error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to delete env var'
        );
      }
    }

    if (failed > 0 && deleted === 0) {
      throw new RailwayProviderError(
        `Failed to delete all ${failed} environment variables`,
        'all_operations_failed'
      );
    }

    return { deleted, failed, failedKeys };
  },
};

// Register the provider
registerProvider(railwayProvider);
