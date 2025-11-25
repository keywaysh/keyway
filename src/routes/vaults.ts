import { FastifyInstance } from 'fastify';
import {
  InitVaultRequestSchema,
  PushSecretsBodySchema,
  RepoEnvParamSchema,
  RepoParamSchema,
  EnvironmentPermissionBodySchema,
} from '../types';
import { db, users, vaults, secrets, environmentPermissions } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import { encrypt, decrypt, sanitizeForLogging } from '../utils/encryption';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import { authenticateGitHub, requireAdminAccess, requireEnvironmentAccess } from '../middleware/auth';
import { ConflictError, NotFoundError } from '../errors';
import { getVaultPermissions, getDefaultPermission } from '../utils/permissions';

/**
 * Parse .env content into key-value pairs
 * Handles comments, empty lines, and quoted values
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Find first = sign
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1);

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert secrets to .env format
 */
function toEnvFormat(secretsMap: Record<string, string>): string {
  return Object.entries(secretsMap)
    .map(([key, value]) => {
      // Quote values that contain special characters
      if (value.includes(' ') || value.includes('\n') || value.includes('"')) {
        return `${key}="${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    })
    .join('\n');
}

export async function vaultRoutes(fastify: FastifyInstance) {
  /**
   * POST /vaults/init
   * Initialize a new vault for a repository
   */
  fastify.post('/init', {
    preHandler: [authenticateGitHub, requireAdminAccess]
  }, async (request, reply) => {
    const body = InitVaultRequestSchema.parse(request.body);
    const githubUser = request.githubUser!;
    const accessToken = request.accessToken!;

    // Get or create user in our database
    let user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          githubId: githubUser.githubId,
          username: githubUser.username,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
          accessToken,
        })
        .returning();

      user = newUser;
    }

    // Check if vault already exists
    const existingVault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, body.repoFullName),
    });

    if (existingVault) {
      throw new ConflictError('Vault already exists for this repository');
    }

    // Create vault
    const [vault] = await db
      .insert(vaults)
      .values({
        repoFullName: body.repoFullName,
        ownerId: user.id,
      })
      .returning();

    // Track event
    trackEvent(user.id, AnalyticsEvents.VAULT_INITIALIZED, {
      repoFullName: body.repoFullName,
    });

    fastify.log.info({
      repoFullName: body.repoFullName,
      userId: user.id,
      vaultId: vault.id,
    }, 'Vault initialized');

    return {
      vaultId: vault.id,
      repoFullName: vault.repoFullName,
      message: 'Vault initialized successfully',
    };
  });

  /**
   * POST /vaults/:repo/:env/push
   * Push secrets to a vault environment
   * Parses .env content and upserts individual secrets
   */
  fastify.post('/:repo/:env/push', {
    preHandler: [authenticateGitHub, requireEnvironmentAccess('write')]
  }, async (request, reply) => {
    const params = RepoEnvParamSchema.parse(request.params);
    const repoFullName = decodeURIComponent(params.repo);
    const environment = params.env;

    const body = PushSecretsBodySchema.parse(request.body);

    const githubUser = request.githubUser!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found. Run keyway init first.');
    }

    // Parse .env content into key-value pairs
    const envPairs = parseEnvContent(body.content);
    const keys = Object.keys(envPairs);

    fastify.log.info({
      repoFullName,
      environment,
      secretCount: keys.length,
      contentPreview: sanitizeForLogging(body.content),
    }, 'Pushing secrets');

    // Get existing secrets for this environment
    const existingSecrets = await db.query.secrets.findMany({
      where: and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, environment)
      ),
    });

    const existingByKey = new Map(existingSecrets.map(s => [s.key, s]));

    // Upsert each secret
    let created = 0;
    let updated = 0;

    for (const [key, value] of Object.entries(envPairs)) {
      const encryptedData = encrypt(value);
      const existing = existingByKey.get(key);

      if (existing) {
        // Update existing secret
        await db
          .update(secrets)
          .set({
            encryptedValue: encryptedData.encryptedContent,
            iv: encryptedData.iv,
            authTag: encryptedData.authTag,
            updatedAt: new Date(),
          })
          .where(eq(secrets.id, existing.id));
        updated++;
      } else {
        // Create new secret
        await db.insert(secrets).values({
          vaultId: vault.id,
          environment,
          key,
          encryptedValue: encryptedData.encryptedContent,
          iv: encryptedData.iv,
          authTag: encryptedData.authTag,
        });
        created++;
      }
    }

    // Delete secrets that are no longer in the pushed content
    const keysToDelete = existingSecrets
      .filter(s => !envPairs.hasOwnProperty(s.key))
      .map(s => s.id);

    if (keysToDelete.length > 0) {
      await db.delete(secrets).where(inArray(secrets.id, keysToDelete));
    }

    // Update vault timestamp
    await db
      .update(vaults)
      .set({ updatedAt: new Date() })
      .where(eq(vaults.id, vault.id));

    // Get user for tracking
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    // Track event
    trackEvent(user?.id || 'anonymous', AnalyticsEvents.SECRETS_PUSHED, {
      repoFullName,
      environment,
      created,
      updated,
      deleted: keysToDelete.length,
    });

    fastify.log.info({
      repoFullName,
      environment,
      userId: user?.id,
      created,
      updated,
      deleted: keysToDelete.length,
    }, 'Secrets pushed successfully');

    return {
      success: true,
      message: 'Secrets pushed successfully',
      stats: {
        created,
        updated,
        deleted: keysToDelete.length,
      },
    };
  });

  /**
   * GET /vaults/:repo/:env/pull
   * Pull secrets from a vault environment
   * Fetches individual secrets and reconstructs .env format
   */
  fastify.get('/:repo/:env/pull', {
    preHandler: [authenticateGitHub, requireEnvironmentAccess('read')]
  }, async (request, reply) => {
    const params = RepoEnvParamSchema.parse(request.params);
    const repoFullName = decodeURIComponent(params.repo);
    const environment = params.env;

    const githubUser = request.githubUser!;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Get all secrets for this environment
    const envSecrets = await db.query.secrets.findMany({
      where: and(
        eq(secrets.vaultId, vault.id),
        eq(secrets.environment, environment)
      ),
    });

    if (envSecrets.length === 0) {
      throw new NotFoundError(`No secrets found for environment: ${environment}`);
    }

    // Decrypt each secret and build the content
    const secretsMap: Record<string, string> = {};

    for (const secret of envSecrets) {
      const decryptedValue = decrypt({
        encryptedContent: secret.encryptedValue,
        iv: secret.iv,
        authTag: secret.authTag,
      });
      secretsMap[secret.key] = decryptedValue;
    }

    // Convert to .env format
    const content = toEnvFormat(secretsMap);

    // Get user for tracking
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, githubUser.githubId),
    });

    // Track event
    trackEvent(user?.id || 'anonymous', AnalyticsEvents.SECRETS_PULLED, {
      repoFullName,
      environment,
      secretCount: envSecrets.length,
    });

    fastify.log.info({
      repoFullName,
      environment,
      userId: user?.id,
      secretCount: envSecrets.length,
      contentPreview: sanitizeForLogging(content),
    }, 'Secrets pulled');

    return {
      content,
    };
  });

  /**
   * GET /vaults/repos/:repo/permissions
   * Get permission configuration for a repository vault
   */
  fastify.get('/repos/:repo/permissions', {
    preHandler: [authenticateGitHub]
  }, async (request, reply) => {
    const params = RepoParamSchema.parse(request.params);
    const repoFullName = decodeURIComponent(params.repo);

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Get permissions
    const permissions = await getVaultPermissions(vault.id);

    return {
      repoFullName,
      vaultId: vault.id,
      ...permissions,
    };
  });

  /**
   * PUT /vaults/repos/:repo/environments/:env/permissions
   * Set custom permission rules for an environment (admin only)
   */
  fastify.put('/repos/:repo/environments/:env/permissions', {
    preHandler: [authenticateGitHub, requireAdminAccess]
  }, async (request, reply) => {
    const params = RepoEnvParamSchema.parse(request.params);
    const repoFullName = decodeURIComponent(params.repo);
    const environment = params.env;

    const body = EnvironmentPermissionBodySchema.parse(request.body);

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Delete existing custom permissions for this environment
    await db
      .delete(environmentPermissions)
      .where(
        and(
          eq(environmentPermissions.vaultId, vault.id),
          eq(environmentPermissions.environment, environment)
        )
      );

    // Insert new custom permissions
    await db.insert(environmentPermissions).values([
      {
        vaultId: vault.id,
        environment,
        permissionType: 'read',
        minRole: body.permissions.read,
      },
      {
        vaultId: vault.id,
        environment,
        permissionType: 'write',
        minRole: body.permissions.write,
      },
    ]);

    fastify.log.info({
      repoFullName,
      environment,
      permissions: body.permissions,
    }, 'Custom permissions set');

    return {
      success: true,
      message: `Custom permissions set for environment: ${environment}`,
      permissions: body.permissions,
    };
  });

  /**
   * DELETE /vaults/repos/:repo/environments/:env/permissions
   * Reset environment to default permissions (admin only)
   */
  fastify.delete('/repos/:repo/environments/:env/permissions', {
    preHandler: [authenticateGitHub, requireAdminAccess]
  }, async (request, reply) => {
    const params = RepoEnvParamSchema.parse(request.params);
    const repoFullName = decodeURIComponent(params.repo);
    const environment = params.env;

    // Get vault
    const vault = await db.query.vaults.findFirst({
      where: eq(vaults.repoFullName, repoFullName),
    });

    if (!vault) {
      throw new NotFoundError('Vault not found');
    }

    // Delete custom permissions for this environment
    await db
      .delete(environmentPermissions)
      .where(
        and(
          eq(environmentPermissions.vaultId, vault.id),
          eq(environmentPermissions.environment, environment)
        )
      );

    fastify.log.info({
      repoFullName,
      environment,
    }, 'Custom permissions reset to defaults');

    return {
      success: true,
      message: `Permissions reset to defaults for environment: ${environment}`,
      defaults: {
        read: getDefaultPermission(environment, 'read'),
        write: getDefaultPermission(environment, 'write'),
      },
    };
  });
}
