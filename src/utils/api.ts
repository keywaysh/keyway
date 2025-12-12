/**
 * Keyway API client
 * Simplified version of cli/src/utils/api.ts
 */

const API_BASE_URL = process.env.KEYWAY_API_URL || 'https://api.keyway.sh';
const USER_AGENT = 'keyway-mcp/1.0.0';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Security: Validate API URL on module load
validateApiUrl(API_BASE_URL);

/**
 * Validate API URL - enforce HTTPS for non-localhost
 */
function validateApiUrl(url: string): void {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    const isLocalhost =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0';

    if (!isLocalhost) {
      throw new Error(
        `Insecure API URL: ${url}. HTTPS is required for non-localhost URLs.`
      );
    }
  }
}

export class APIError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Check if error is retryable (5xx or network error)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof APIError) {
    return error.isRetryable || (error.statusCode >= 500 && error.statusCode < 600);
  }
  // Network errors are retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('timeout')
    );
  }
  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch with retry logic for transient errors
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === MAX_RETRIES - 1) {
        throw error;
      }
      // Exponential backoff: 1s, 2s, 4s
      await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
    }
  }

  throw lastError;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      try {
        const error = JSON.parse(text);
        throw new APIError(
          response.status,
          error.title || 'Error',
          error.detail || `HTTP ${response.status}`
        );
      } catch (e) {
        if (e instanceof APIError) throw e;
        throw new APIError(response.status, 'Error', text || `HTTP ${response.status}`);
      }
    }
    throw new APIError(response.status, 'Error', text || `HTTP ${response.status}`);
  }

  if (!text) {
    return {} as T;
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(text) as T;
  }

  return { content: text } as unknown as T;
}

export interface PushResult {
  stats?: {
    created: number;
    updated: number;
    deleted: number;
  };
}

/**
 * Pull secrets from vault (returns .env format content)
 */
export async function pullSecrets(
  repository: string,
  environment: string,
  token: string
): Promise<string> {
  validateEnvironment(environment);

  const params = new URLSearchParams({
    repo: repository,
    environment,
  });

  const response = await fetchWithRetry(`${API_BASE_URL}/v1/secrets/pull?${params}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
  });

  const result = await handleResponse<{ data?: { content?: string } }>(response);

  // Defensive check for response format
  if (!result.data || typeof result.data.content !== 'string') {
    throw new APIError(500, 'INVALID_RESPONSE', 'Invalid response format from API');
  }

  return result.data.content;
}

/**
 * Push secrets to vault
 */
export async function pushSecrets(
  repository: string,
  environment: string,
  secrets: Record<string, string>,
  token: string
): Promise<PushResult> {
  validateEnvironment(environment);

  const response = await fetchWithRetry(`${API_BASE_URL}/v1/secrets/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      repoFullName: repository,
      environment,
      secrets,
    }),
  });

  const result = await handleResponse<{ data?: PushResult }>(response);

  // Defensive check
  if (!result.data) {
    return {};
  }

  return result.data;
}

/**
 * Get vault environments
 */
export async function getVaultEnvironments(
  repository: string,
  token: string
): Promise<string[]> {
  const [owner, repo] = repository.split('/');

  if (!owner || !repo) {
    throw new APIError(400, 'INVALID_REPOSITORY', 'Invalid repository format. Expected "owner/repo"');
  }

  const response = await fetchWithRetry(
    `${API_BASE_URL}/v1/vaults/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const result = await handleResponse<{ data?: { environments?: string[] } }>(response);

  // Return environments from response, or default list if not available
  return result.data?.environments || DEFAULT_ENVIRONMENTS;
}

/**
 * Valid environment name pattern
 */
const ENVIRONMENT_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const DEFAULT_ENVIRONMENTS = ['development', 'staging', 'production'];

/**
 * Validate environment name
 */
function validateEnvironment(environment: string): void {
  if (!environment || !ENVIRONMENT_PATTERN.test(environment)) {
    throw new APIError(
      400,
      'INVALID_ENVIRONMENT',
      `Invalid environment name "${environment}". Must start with a letter and contain only letters, numbers, underscores, and hyphens.`
    );
  }
}
