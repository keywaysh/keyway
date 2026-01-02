/**
 * VCS Provider Registry
 *
 * Central registry for all VCS providers (GitHub, GitLab, Bitbucket).
 * Use getProvider(forgeType) to get the appropriate provider instance.
 */

import type { ForgeType } from "./types";
import { VcsProvider } from "./base.provider";
import { gitHubProvider } from "./github/github.provider";

// ============================================================================
// Provider Registry
// ============================================================================

const providers = new Map<ForgeType, VcsProvider>();

/**
 * Register a VCS provider
 */
export function registerProvider(provider: VcsProvider): void {
  providers.set(provider.forgeType, provider);
}

/**
 * Get a VCS provider by forge type
 * @throws Error if provider not registered
 */
export function getProvider(forgeType: ForgeType): VcsProvider {
  const provider = providers.get(forgeType);
  if (!provider) {
    throw new Error(`No VCS provider registered for forge type: ${forgeType}`);
  }
  return provider;
}

/**
 * Check if a provider is registered for a forge type
 */
export function hasProvider(forgeType: ForgeType): boolean {
  return providers.has(forgeType);
}

/**
 * Get all registered forge types
 */
export function getRegisteredForges(): ForgeType[] {
  return Array.from(providers.keys());
}

// ============================================================================
// Auto-register Providers
// ============================================================================

// Register GitHub provider by default
registerProvider(gitHubProvider);

// Future: Register GitLab and Bitbucket providers when implemented
// registerProvider(gitLabProvider);
// registerProvider(bitbucketProvider);

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  ForgeType,
  NormalizedRole,
  VcsUser,
  VcsRepository,
  VcsOrganization,
  VcsCollaborator,
  VcsOrgMember,
  TokenResponse,
  OAuthConfig,
  VcsAppInstallation,
  RoleMapper,
  VcsProviderInterface,
} from "./types";

// Base provider
export { VcsProvider } from "./base.provider";

// GitHub provider
export { GitHubProvider, gitHubProvider, gitHubRoleMapper } from "./github/github.provider";
export { GitHubApiClient, githubApiClient } from "./github/github.api-client";
