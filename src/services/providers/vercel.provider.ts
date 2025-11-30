/**
 * Vercel Provider Implementation
 * Handles OAuth and Environment Variables API for Vercel
 */

import {
  Provider,
  TokenResponse,
  ProviderProject,
  ProviderEnvVar,
  ProviderUser,
  registerProvider,
} from './base.provider';
import { config } from '../../config';

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_OAUTH_BASE = 'https://vercel.com';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

// Logger for provider operations - sanitizes context to prevent token leakage
const logger = {
  error: (context: Record<string, unknown>, message: string) => {
    const sanitized = sanitizeLogContext(context);
    console.error(`[VercelProvider] ${message}`, JSON.stringify(sanitized, null, 2));
  },
  warn: (context: Record<string, unknown>, message: string) => {
    const sanitized = sanitizeLogContext(context);
    console.warn(`[VercelProvider] ${message}`, JSON.stringify(sanitized, null, 2));
  },
};

// Sanitize context to prevent token/secret leakage in logs
function sanitizeLogContext(context: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['token', 'accessToken', 'refreshToken', 'secret', 'password', 'authorization'];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 100) {
      // Truncate long strings that might contain tokens
      result[key] = value.substring(0, 50) + '...[truncated]';
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Safely stringify an object, catching any errors to prevent secret leakage
 */
function safeStringify(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj);
  } catch {
    throw new Error('Failed to serialize request body');
  }
}

interface VercelApiError {
  error?: {
    code: string;
    message: string;
  };
}

class VercelProviderError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'VercelProviderError';
  }
}

async function vercelFetch<T>(
  url: string,
  accessToken: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new VercelProviderError(
        `Rate limited by Vercel API. Retry after ${retryAfter || 'a few'} seconds.`,
        'rate_limited',
        429
      );
    }

    // Parse JSON with error handling
    let data: T & VercelApiError;
    try {
      data = await response.json() as T & VercelApiError;
    } catch (parseError) {
      // Handle non-JSON responses (e.g., gateway errors, HTML error pages)
      throw new VercelProviderError(
        `Vercel API returned invalid response: ${response.status} ${response.statusText}`,
        'invalid_response',
        response.status
      );
    }

    if (!response.ok) {
      throw new VercelProviderError(
        data.error?.message || `Vercel API error: ${response.status}`,
        data.error?.code,
        response.status
      );
    }

    return data;
  } catch (error) {
    // Handle abort/timeout
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VercelProviderError(
        `Request to Vercel API timed out after ${timeoutMs / 1000}s`,
        'timeout',
        0
      );
    }
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new VercelProviderError(
        'Network error connecting to Vercel API. Check your internet connection.',
        'network_error',
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildTeamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

export const vercelProvider: Provider = {
  name: 'vercel',
  displayName: 'Vercel',

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: config.vercel?.clientId || '',
      redirect_uri: redirectUri,
      state,
      scope: 'user:read', // Minimal scope, env var access is implicit with project access
    });
    return `${VERCEL_OAUTH_BASE}/integrations/install/new?${params.toString()}`;
  },

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenResponse> {
    const response = await fetch(`${VERCEL_API_BASE}/v2/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.vercel?.clientId || '',
        client_secret: config.vercel?.clientSecret || '',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json() as {
      access_token?: string;
      token_type?: string;
      team_id?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !data.access_token) {
      throw new VercelProviderError(
        data.error_description || data.error || 'Failed to exchange code for token',
        data.error,
        response.status
      );
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      // Vercel tokens don't expire, but we could set a long expiry for rotation purposes
    };
  },

  async getUser(accessToken: string): Promise<ProviderUser> {
    const data = await vercelFetch<{
      user: {
        id: string;
        username: string;
        email: string;
        name?: string;
      };
    }>(`${VERCEL_API_BASE}/v2/user`, accessToken);

    return {
      id: data.user.id,
      username: data.user.username,
      email: data.user.email,
    };
  },

  async listProjects(accessToken: string, teamId?: string): Promise<ProviderProject[]> {
    const query = buildTeamQuery(teamId);
    const data = await vercelFetch<{
      projects: Array<{
        id: string;
        name: string;
        framework?: string;
        createdAt: number;
        link?: {
          type: string;
          repo?: string;
          org?: string;
          repoId?: number;
        };
      }>;
    }>(`${VERCEL_API_BASE}/v9/projects${query}`, accessToken);

    return data.projects.map(p => ({
      id: p.id,
      name: p.name,
      linkedRepo: p.link?.type === 'github' && p.link.org && p.link.repo
        ? `${p.link.org}/${p.link.repo}`
        : undefined,
      framework: p.framework,
      createdAt: new Date(p.createdAt),
    }));
  },

  async getProject(accessToken: string, projectId: string, teamId?: string): Promise<ProviderProject | null> {
    try {
      const query = buildTeamQuery(teamId);
      const data = await vercelFetch<{
        id: string;
        name: string;
        framework?: string;
        createdAt: number;
        link?: {
          type: string;
          repo?: string;
          org?: string;
        };
      }>(`${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(projectId)}${query}`, accessToken);

      return {
        id: data.id,
        name: data.name,
        linkedRepo: data.link?.type === 'github' && data.link.org && data.link.repo
          ? `${data.link.org}/${data.link.repo}`
          : undefined,
        framework: data.framework,
        createdAt: new Date(data.createdAt),
      };
    } catch (error) {
      if (error instanceof VercelProviderError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  async listEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    teamId?: string
  ): Promise<ProviderEnvVar[]> {
    const query = buildTeamQuery(teamId);
    const data = await vercelFetch<{
      envs: Array<{
        id: string;
        key: string;
        value?: string;
        target: string[];
        type: string;
        createdAt: number;
        updatedAt: number;
      }>;
    }>(`${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env${query}`, accessToken);

    // Filter by target environment
    const targetEnv = environment.toLowerCase();
    return data.envs
      .filter(env => env.target.some(t => t.toLowerCase() === targetEnv))
      .map(env => ({
        key: env.key,
        value: env.value, // May be undefined for encrypted vars
        target: env.target,
        type: env.type,
        createdAt: new Date(env.createdAt),
        updatedAt: new Date(env.updatedAt),
      }));
  },

  async setEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    vars: Record<string, string>,
    teamId?: string
  ): Promise<{ created: number; updated: number; failed: number; failedKeys: string[] }> {
    const query = buildTeamQuery(teamId);
    const targetEnv = environment.toLowerCase();

    // First, get existing env vars to know which to create vs update
    const existingEnvs = await vercelFetch<{
      envs: Array<{
        id: string;
        key: string;
        target: string[];
      }>;
    }>(`${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env${query}`, accessToken);

    // Build a map of existing keys to their IDs
    const existingMap = new Map<string, { id: string; targets: string[] }>();
    for (const env of existingEnvs.envs) {
      existingMap.set(env.key, { id: env.id, targets: env.target });
    }

    let created = 0;
    let updated = 0;
    let failed = 0;
    const failedKeys: string[] = [];

    for (const [key, value] of Object.entries(vars)) {
      try {
        const existing = existingMap.get(key);

        if (existing) {
          // Update existing env var
          // Check if it already targets this environment
          const alreadyTargetsEnv = existing.targets.some(t => t.toLowerCase() === targetEnv);

          if (alreadyTargetsEnv) {
            // Update the value
            await vercelFetch(
              `${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env/${existing.id}${query}`,
              accessToken,
              {
                method: 'PATCH',
                body: safeStringify({
                  value,
                  type: 'encrypted',
                }),
              }
            );
          } else {
            // Add this environment to targets
            await vercelFetch(
              `${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env/${existing.id}${query}`,
              accessToken,
              {
                method: 'PATCH',
                body: safeStringify({
                  value,
                  target: [...existing.targets, targetEnv],
                  type: 'encrypted',
                }),
              }
            );
          }
          updated++;
        } else {
          // Create new env var
          await vercelFetch(
            `${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env${query}`,
            accessToken,
            {
              method: 'POST',
              body: safeStringify({
                key,
                value,
                target: [targetEnv],
                type: 'encrypted',
              }),
            }
          );
          created++;
        }
      } catch (error) {
        // Track partial failure but continue with other keys
        failed++;
        failedKeys.push(key);
        logger.error(
          { key, projectId, environment, error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to set env var'
        );
      }
    }

    // If all operations failed, throw an error
    if (failed > 0 && created === 0 && updated === 0) {
      throw new VercelProviderError(
        `Failed to set all ${failed} environment variables`,
        'all_operations_failed',
        0
      );
    }

    return { created, updated, failed, failedKeys };
  },

  async deleteEnvVar(
    accessToken: string,
    projectId: string,
    environment: string,
    key: string,
    teamId?: string
  ): Promise<void> {
    const query = buildTeamQuery(teamId);
    const targetEnv = environment.toLowerCase();

    // Get the env var by key to find its ID
    const existingEnvs = await vercelFetch<{
      envs: Array<{
        id: string;
        key: string;
        target: string[];
      }>;
    }>(`${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env${query}`, accessToken);

    const envVar = existingEnvs.envs.find(e => e.key === key);
    if (!envVar) return;

    // If the env var targets multiple environments, just remove this one
    const remainingTargets = envVar.target.filter(t => t.toLowerCase() !== targetEnv);

    if (remainingTargets.length > 0) {
      // Update to remove just this environment
      await vercelFetch(
        `${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env/${envVar.id}${query}`,
        accessToken,
        {
          method: 'PATCH',
          body: safeStringify({
            target: remainingTargets,
          }),
        }
      );
    } else {
      // Delete entirely
      await vercelFetch(
        `${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(projectId)}/env/${envVar.id}${query}`,
        accessToken,
        { method: 'DELETE' }
      );
    }
  },

  async deleteEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    keys: string[],
    teamId?: string
  ): Promise<{ deleted: number; failed: number; failedKeys: string[] }> {
    let deleted = 0;
    let failed = 0;
    const failedKeys: string[] = [];

    for (const key of keys) {
      try {
        await this.deleteEnvVar(accessToken, projectId, environment, key, teamId);
        deleted++;
      } catch (error) {
        // Track failure but continue with other keys
        failed++;
        failedKeys.push(key);
        logger.error(
          { key, projectId, environment, error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to delete env var'
        );
      }
    }

    // If all operations failed, throw an error
    if (failed > 0 && deleted === 0) {
      throw new VercelProviderError(
        `Failed to delete all ${failed} environment variables`,
        'all_operations_failed',
        0
      );
    }

    return { deleted, failed, failedKeys };
  },
};

// Register the provider
registerProvider(vercelProvider);

export { VercelProviderError };
