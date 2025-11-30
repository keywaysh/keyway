/**
 * Base Provider Interface
 * All provider implementations (Vercel, Netlify, Railway, etc.) must implement this interface.
 */

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number; // seconds until expiration
  tokenType?: string;
  scope?: string;
}

export interface ProviderProject {
  id: string;
  name: string;
  linkedRepo?: string; // e.g., "owner/repo"
  framework?: string;
  createdAt?: Date;
}

export interface ProviderEnvVar {
  key: string;
  value?: string; // May be redacted
  target?: string[]; // e.g., ['production', 'preview']
  type?: string; // e.g., 'encrypted', 'plain'
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProviderUser {
  id: string;
  username: string;
  email?: string;
  teamId?: string;
  teamName?: string;
}

export interface Provider {
  /** Unique provider identifier (e.g., 'vercel', 'netlify') */
  name: string;

  /** Human-readable display name (e.g., 'Vercel', 'Netlify') */
  displayName: string;

  /**
   * OAuth Methods
   */

  /** Generate the OAuth authorization URL */
  getAuthorizationUrl(state: string, redirectUri: string): string;

  /** Exchange authorization code for access token */
  exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenResponse>;

  /** Refresh an expired access token */
  refreshToken?(refreshToken: string): Promise<TokenResponse>;

  /**
   * User/Team Methods
   */

  /** Get the authenticated user's information */
  getUser(accessToken: string): Promise<ProviderUser>;

  /**
   * Project Methods
   */

  /** List all projects accessible by the token */
  listProjects(accessToken: string, teamId?: string): Promise<ProviderProject[]>;

  /** Get a specific project by ID */
  getProject?(accessToken: string, projectId: string, teamId?: string): Promise<ProviderProject | null>;

  /**
   * Environment Variables Methods
   */

  /** List environment variables for a project */
  listEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    teamId?: string
  ): Promise<ProviderEnvVar[]>;

  /** Set (create or update) environment variables */
  setEnvVars(
    accessToken: string,
    projectId: string,
    environment: string,
    vars: Record<string, string>,
    teamId?: string
  ): Promise<{ created: number; updated: number; failed?: number; failedKeys?: string[] }>;

  /** Delete an environment variable */
  deleteEnvVar(
    accessToken: string,
    projectId: string,
    environment: string,
    key: string,
    teamId?: string
  ): Promise<void>;

  /** Delete multiple environment variables */
  deleteEnvVars?(
    accessToken: string,
    projectId: string,
    environment: string,
    keys: string[],
    teamId?: string
  ): Promise<{ deleted: number; failed?: number; failedKeys?: string[] }>;
}

/**
 * Provider registry for looking up providers by name
 */
const providers = new Map<string, Provider>();

export function registerProvider(provider: Provider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): Provider | undefined {
  return providers.get(name);
}

export function getAllProviders(): Provider[] {
  return Array.from(providers.values());
}

export function getAvailableProviders(): { name: string; displayName: string }[] {
  return getAllProviders().map(p => ({
    name: p.name,
    displayName: p.displayName,
  }));
}
