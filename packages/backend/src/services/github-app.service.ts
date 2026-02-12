import * as crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  vcsAppInstallations,
  vcsAppInstallationRepos,
  vcsAppInstallationTokens,
  type VcsAppInstallation,
  type InstallationAccountType,
  type InstallationStatus,
} from "../db/schema";
import { config } from "../config";
import { ForbiddenError, NotFoundError } from "../lib";
import { getEncryptionService } from "../utils/encryption";
import { logger } from "../utils/sharedLogger";

const GITHUB_API_BASE = config.github?.apiBaseUrl || "https://api.github.com";

// JWT expires in 10 minutes (GitHub maximum)
const JWT_EXPIRY_SECONDS = 10 * 60;

// Installation token expires in 1 hour, refresh 5 minutes before
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Generate a JWT for GitHub App authentication
 * Uses RS256 algorithm with the private key
 */
export function generateAppJWT(): string {
  const now = Math.floor(Date.now() / 1000);

  // JWT Header
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  // JWT Payload
  const payload = {
    iat: now - 60, // Issued 60 seconds ago (clock skew tolerance)
    exp: now + JWT_EXPIRY_SECONDS,
    iss: config.githubApp.appId,
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Sign with private key
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(config.githubApp.privateKey);
  const encodedSignature = base64UrlEncode(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Get an installation token for a GitHub App installation
 * Checks cache first, refreshes if expired or about to expire
 */
export async function getInstallationToken(
  installationId: number,
  options?: { repositories?: number[] }
): Promise<string> {
  logger.debug({ installationId }, "Getting installation token");

  // Find the installation in our database
  const installation = await db.query.vcsAppInstallations.findFirst({
    where: eq(vcsAppInstallations.installationId, installationId),
    with: { tokenCache: true },
  });

  if (!installation) {
    logger.error({ installationId }, "Installation not found in database");
    throw new NotFoundError(`Installation ${installationId} not found`);
  }

  logger.debug(
    {
      account: installation.accountLogin,
      status: installation.status,
      selection: installation.repositorySelection,
    },
    "Found installation"
  );

  // Check if we have a cached token that's still valid
  if (installation.tokenCache) {
    const expiresAt = new Date(installation.tokenCache.expiresAt);
    const isValid = expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS;

    if (isValid) {
      logger.debug({ expiresAt: expiresAt.toISOString() }, "Using cached token");
      // Decrypt and return cached token
      const encryptionService = await getEncryptionService();
      return encryptionService.decrypt({
        encryptedContent: installation.tokenCache.encryptedToken,
        iv: installation.tokenCache.tokenIv,
        authTag: installation.tokenCache.tokenAuthTag,
        version: installation.tokenCache.tokenEncryptionVersion,
      });
    } else {
      logger.debug(
        { expiresAt: expiresAt.toISOString() },
        "Cached token expired or expiring soon, refreshing"
      );
    }
  } else {
    logger.debug("No cached token found, generating new one");
  }

  // Generate new installation token
  const jwt = generateAppJWT();

  const body: Record<string, unknown> = {};
  if (options?.repositories) {
    body.repository_ids = options.repositories;
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    logger.error(
      { status: response.status, error, installationId },
      "Failed to get installation token from GitHub API"
    );
    throw new Error(
      `Failed to get installation token for installation ${installationId}: ${response.status} ${error}`
    );
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: string;
  };

  logger.debug({ expiresAt: data.expires_at }, "Successfully obtained new installation token");

  // Encrypt and cache the token
  const encryptionService = await getEncryptionService();
  const encrypted = await encryptionService.encrypt(data.token);

  await db
    .insert(vcsAppInstallationTokens)
    .values({
      installationId: installation.id,
      encryptedToken: encrypted.encryptedContent,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenEncryptionVersion: encrypted.version ?? 1,
      expiresAt: new Date(data.expires_at),
    })
    .onConflictDoUpdate({
      target: vcsAppInstallationTokens.installationId,
      set: {
        encryptedToken: encrypted.encryptedContent,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        tokenEncryptionVersion: encrypted.version ?? 1,
        expiresAt: new Date(data.expires_at),
        createdAt: new Date(),
      },
    });

  return data.token;
}

/**
 * Find the GitHub App installation for a specific repository
 * Returns null if no installation covers this repo
 */
export async function findInstallationForRepo(
  repoOwner: string,
  repoName: string
): Promise<VcsAppInstallation | null> {
  const repoFullName = `${repoOwner}/${repoName}`;
  logger.debug({ repoFullName }, "Finding installation for repo");

  // First, check if repo is in selected repos for any installation
  const repoEntry = await db.query.vcsAppInstallationRepos.findFirst({
    where: eq(vcsAppInstallationRepos.repoFullName, repoFullName),
    with: { installation: true },
  });

  if (repoEntry?.installation && repoEntry.installation.status === "active") {
    logger.debug(
      {
        installationId: repoEntry.installation.installationId,
        account: repoEntry.installation.accountLogin,
      },
      "Found via selected repos"
    );
    return repoEntry.installation;
  }

  if (repoEntry?.installation) {
    logger.debug(
      { status: repoEntry.installation.status },
      "Found repo entry but installation not active"
    );
  }

  // Check if there's an "all repos" installation for this account
  const allReposInstallation = await db.query.vcsAppInstallations.findFirst({
    where: and(
      eq(vcsAppInstallations.accountLogin, repoOwner),
      eq(vcsAppInstallations.repositorySelection, "all"),
      eq(vcsAppInstallations.status, "active")
    ),
  });

  if (allReposInstallation) {
    logger.debug(
      {
        installationId: allReposInstallation.installationId,
        account: allReposInstallation.accountLogin,
      },
      "Found via all repos installation"
    );
    return allReposInstallation;
  }

  // Fallback: check GitHub API directly (handles cases where webhook didn't fire)
  logger.debug({ repoFullName }, "DB lookup failed, checking GitHub API");
  const apiInstallation = await findInstallationViaGitHubAPI(repoOwner, repoName);
  if (apiInstallation) {
    logger.debug(
      { installationId: apiInstallation.installationId },
      "Found via GitHub API, syncing to DB"
    );
    // Sync to DB for future lookups
    await syncInstallationFromAPI(apiInstallation);
    return apiInstallation;
  }

  logger.warn({ repoFullName }, "No installation found for repo");
  return null;
}

/**
 * Check GitHub API directly for repo installation (fallback when DB is out of sync)
 */
async function findInstallationViaGitHubAPI(
  repoOwner: string,
  repoName: string
): Promise<VcsAppInstallation | null> {
  try {
    const jwt = generateAppJWT();
    const response = await fetch(`${GITHUB_API_BASE}/repos/${repoOwner}/${repoName}/installation`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      logger.debug({ status: response.status, repoOwner, repoName }, "GitHub API response");
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      account: { id: number; login: string; type: string };
      repository_selection: "all" | "selected";
      permissions: Record<string, string>;
    };

    // Return a VcsAppInstallation-like object
    return {
      id: "", // Will be set when synced to DB
      forgeType: "github" as const,
      installationId: data.id,
      accountId: data.account.id,
      accountLogin: data.account.login,
      accountType: data.account.type.toLowerCase() as InstallationAccountType,
      repositorySelection: data.repository_selection,
      permissions: data.permissions,
      status: "active" as InstallationStatus,
      installedByUserId: null,
      installedAt: new Date(),
      updatedAt: new Date(),
      suspendedAt: null,
      deletedAt: null,
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown" },
      "Error checking GitHub API"
    );
    return null;
  }
}

/**
 * Find installation for an organization via GitHub API
 * Used when the installation webhook was missed
 */
export async function findOrgInstallationViaGitHubAPI(
  orgLogin: string
): Promise<VcsAppInstallation | null> {
  try {
    const jwt = generateAppJWT();
    const response = await fetch(`${GITHUB_API_BASE}/orgs/${orgLogin}/installation`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      logger.debug(
        { status: response.status, orgLogin },
        "Org installation not found via GitHub API"
      );
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      account: { id: number; login: string; type: string };
      repository_selection: "all" | "selected";
      permissions: Record<string, string>;
    };

    // Return a VcsAppInstallation-like object
    return {
      id: "", // Will be set when synced to DB
      forgeType: "github" as const,
      installationId: data.id,
      accountId: data.account.id,
      accountLogin: data.account.login,
      accountType: data.account.type.toLowerCase() as InstallationAccountType,
      repositorySelection: data.repository_selection,
      permissions: data.permissions,
      status: "active" as InstallationStatus,
      installedByUserId: null,
      installedAt: new Date(),
      updatedAt: new Date(),
      suspendedAt: null,
      deletedAt: null,
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown", orgLogin },
      "Error checking org installation via GitHub API"
    );
    return null;
  }
}

/**
 * Sync an installation found via API to the database
 * Uses createInstallation which handles upsert
 */
export async function syncInstallationFromAPI(installation: VcsAppInstallation): Promise<void> {
  try {
    await createInstallation({
      installationId: installation.installationId,
      accountId: installation.accountId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection as "all" | "selected",
      permissions: installation.permissions as Record<string, string>,
    });
    logger.debug({ installationId: installation.installationId }, "Synced installation to DB");
  } catch (error) {
    // Don't fail if sync fails - we can still proceed with the API-found installation
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown" },
      "Failed to sync installation to DB"
    );
  }
}

/**
 * Check installation status for a repo (non-throwing)
 */
export async function checkInstallationStatus(
  repoOwner: string,
  repoName: string
): Promise<{
  installed: boolean;
  installationId?: number;
  installUrl: string;
}> {
  const installation = await findInstallationForRepo(repoOwner, repoName);

  // Build install URL - simpler URL without invalid params
  // The GitHub App install page will let the user select repos
  const installUrl = config.githubApp.installUrl;

  if (installation) {
    return {
      installed: true,
      installationId: installation.installationId,
      installUrl,
    };
  }

  return {
    installed: false,
    installUrl,
  };
}

/**
 * Assert that a repo is accessible via GitHub App
 * Throws ForbiddenError if not installed
 */
export async function assertRepoAccessViaApp(
  repoOwner: string,
  repoName: string
): Promise<{ installationId: number; token: string }> {
  const installation = await findInstallationForRepo(repoOwner, repoName);

  if (!installation) {
    throw new ForbiddenError(
      `GitHub App not installed for ${repoOwner}/${repoName}. ` +
        `Please install the Keyway GitHub App: ${config.githubApp.installUrl}`
    );
  }

  const token = await getInstallationToken(installation.installationId);

  return { installationId: installation.installationId, token };
}

// ============================================================================
// Installation CRUD (for webhook handlers)
// ============================================================================

interface CreateInstallationInput {
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: InstallationAccountType;
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
  repositories?: Array<{
    id: number;
    full_name: string;
    private: boolean;
  }>;
  installedByUserId?: string;
}

/**
 * Create a new installation record (called from webhook)
 */
export async function createInstallation(
  input: CreateInstallationInput
): Promise<VcsAppInstallation> {
  const [installation] = await db
    .insert(vcsAppInstallations)
    .values({
      installationId: input.installationId,
      accountId: input.accountId,
      accountLogin: input.accountLogin,
      accountType: input.accountType,
      repositorySelection: input.repositorySelection,
      permissions: input.permissions,
      installedByUserId: input.installedByUserId,
    })
    .onConflictDoUpdate({
      target: [vcsAppInstallations.forgeType, vcsAppInstallations.installationId],
      set: {
        accountLogin: input.accountLogin,
        repositorySelection: input.repositorySelection,
        permissions: input.permissions,
        status: "active",
        updatedAt: new Date(),
        deletedAt: null,
        suspendedAt: null,
      },
    })
    .returning();

  // Add repositories if provided
  if (input.repositories && input.repositories.length > 0) {
    await db
      .insert(vcsAppInstallationRepos)
      .values(
        input.repositories.map((repo) => ({
          installationId: installation.id,
          repoId: repo.id,
          repoFullName: repo.full_name,
          repoPrivate: repo.private,
        }))
      )
      .onConflictDoNothing();
  }

  return installation;
}

/**
 * Mark an installation as deleted (called from webhook)
 */
export async function deleteInstallation(installationId: number): Promise<void> {
  await db
    .update(vcsAppInstallations)
    .set({
      status: "deleted" as InstallationStatus,
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vcsAppInstallations.installationId, installationId));

  // Clear token cache
  const installation = await db.query.vcsAppInstallations.findFirst({
    where: eq(vcsAppInstallations.installationId, installationId),
  });

  if (installation) {
    await db
      .delete(vcsAppInstallationTokens)
      .where(eq(vcsAppInstallationTokens.installationId, installation.id));
  }
}

/**
 * Update installation status (suspend/unsuspend)
 */
export async function updateInstallationStatus(
  installationId: number,
  status: InstallationStatus
): Promise<void> {
  const updates: Partial<VcsAppInstallation> = {
    status,
    updatedAt: new Date(),
  };

  if (status === "suspended") {
    updates.suspendedAt = new Date();
  } else if (status === "active") {
    updates.suspendedAt = null;
  }

  await db
    .update(vcsAppInstallations)
    .set(updates)
    .where(eq(vcsAppInstallations.installationId, installationId));
}

/**
 * Update repositories for an installation (called from webhook)
 */
export async function updateInstallationRepos(
  installationId: number,
  added: Array<{ id: number; full_name: string; private: boolean }>,
  removed: Array<{ id: number }>
): Promise<void> {
  const installation = await db.query.vcsAppInstallations.findFirst({
    where: eq(vcsAppInstallations.installationId, installationId),
  });

  if (!installation) {
    return;
  }

  // Add new repos
  if (added.length > 0) {
    await db
      .insert(vcsAppInstallationRepos)
      .values(
        added.map((repo) => ({
          installationId: installation.id,
          repoId: repo.id,
          repoFullName: repo.full_name,
          repoPrivate: repo.private,
        }))
      )
      .onConflictDoNothing();
  }

  // Remove repos
  for (const repo of removed) {
    await db
      .delete(vcsAppInstallationRepos)
      .where(
        and(
          eq(vcsAppInstallationRepos.installationId, installation.id),
          eq(vcsAppInstallationRepos.repoId, repo.id)
        )
      );
  }

  await db
    .update(vcsAppInstallations)
    .set({ updatedAt: new Date() })
    .where(eq(vcsAppInstallations.id, installation.id));
}

/**
 * Get all installations for a user
 */
export async function getInstallationsForUser(userId: string): Promise<VcsAppInstallation[]> {
  return db.query.vcsAppInstallations.findMany({
    where: and(
      eq(vcsAppInstallations.installedByUserId, userId),
      eq(vcsAppInstallations.status, "active")
    ),
    with: { repos: true },
  });
}

/**
 * Get installation by GitHub installation ID
 */
export async function getInstallationByGitHubId(
  installationId: number
): Promise<VcsAppInstallation | undefined> {
  return db.query.vcsAppInstallations.findFirst({
    where: eq(vcsAppInstallations.installationId, installationId),
  });
}

/**
 * Handle GitHub App installation from callback
 * Fetches installation details from GitHub API and stores in DB
 */
export async function handleInstallationCreated(
  installationId: number,
  installedByUserId?: string
): Promise<VcsAppInstallation> {
  // Fetch installation details from GitHub API
  const jwt = generateAppJWT();

  const installationResponse = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!installationResponse.ok) {
    const error = await installationResponse.text();
    throw new Error(
      `Failed to fetch installation ${installationId}: ${installationResponse.status} ${error}`
    );
  }

  const installationData = (await installationResponse.json()) as {
    id: number;
    account: {
      id: number;
      login: string;
      type: string;
    };
    repository_selection: "all" | "selected";
    permissions: Record<string, string>;
  };

  // Fetch repositories if selection is 'selected'
  let repositories: Array<{ id: number; full_name: string; private: boolean }> = [];

  if (installationData.repository_selection === "selected") {
    const reposResponse = await fetch(`${GITHUB_API_BASE}/installation/repositories`, {
      headers: {
        Authorization: `Bearer ${await getInstallationTokenDirect(installationId)}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (reposResponse.ok) {
      const reposData = (await reposResponse.json()) as {
        repositories: Array<{ id: number; full_name: string; private: boolean }>;
      };
      repositories = reposData.repositories;
    }
  }

  // Store in database
  return createInstallation({
    installationId: installationData.id,
    accountId: installationData.account.id,
    accountLogin: installationData.account.login,
    accountType: installationData.account.type.toLowerCase() as InstallationAccountType,
    repositorySelection: installationData.repository_selection,
    permissions: installationData.permissions,
    repositories,
    installedByUserId,
  });
}

/**
 * Get installation token directly (without caching) - used for initial setup
 */
async function getInstallationTokenDirect(installationId: number): Promise<string> {
  const jwt = generateAppJWT();

  const response = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get installation token: ${response.status} ${error}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}

// ============================================================================
// Helpers
// ============================================================================

function base64UrlEncode(input: string | Buffer): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
