import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { z } from 'zod';
import { config } from '../../../config';
import { authenticateGitHub } from '../../../middleware/auth';
import {
  checkInstallationStatus,
  createInstallation,
  deleteInstallation,
  updateInstallationStatus,
  updateInstallationRepos,
  getInstallationsForUser,
  getInstallationByGitHubId,
  logActivity,
} from '../../../services';
import { db, users } from '../../../db';
import { eq } from 'drizzle-orm';
import { sendData, sendNoContent } from '../../../lib/response';
import { BadRequestError, ForbiddenError } from '../../../lib/errors';
import type { InstallationAccountType } from '../../../db/schema';

// Schemas
const CheckInstallationSchema = z.object({
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
});

// GitHub webhook payload types
interface GitHubWebhookInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: 'User' | 'Organization';
  };
  repository_selection: 'all' | 'selected';
  permissions: Record<string, string>;
  sender?: {
    id: number;
    login: string;
  };
}

interface GitHubWebhookRepository {
  id: number;
  full_name: string;
  private: boolean;
}

interface GitHubWebhookPayload {
  action: string;
  installation: GitHubWebhookInstallation;
  repositories?: GitHubWebhookRepository[];
  repositories_added?: GitHubWebhookRepository[];
  repositories_removed?: GitHubWebhookRepository[];
  sender?: {
    id: number;
    login: string;
  };
}

/**
 * GitHub App routes
 * POST /v1/github/check-installation - Check if GitHub App is installed for a repo
 * GET  /v1/github/installations - List user's installations
 * POST /v1/github/webhook - Handle GitHub App webhooks
 */
export async function githubRoutes(fastify: FastifyInstance) {
  /**
   * POST /check-installation
   * Check if GitHub App is installed for a specific repository
   */
  fastify.post('/check-installation', {
    preHandler: [authenticateGitHub],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CheckInstallationSchema.parse(request.body);

    const status = await checkInstallationStatus(body.repoOwner, body.repoName);

    return sendData(reply, status, { requestId: request.id });
  });

  /**
   * GET /installations
   * List all GitHub App installations for the authenticated user
   */
  fastify.get('/installations', {
    preHandler: [authenticateGitHub],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, request.githubUser!.githubId),
    });

    if (!user) {
      return sendData(reply, { installations: [] }, { requestId: request.id });
    }

    const installations = await getInstallationsForUser(user.id);

    return sendData(reply, {
      installations: installations.map((inst) => ({
        id: inst.id,
        installationId: inst.installationId,
        accountLogin: inst.accountLogin,
        accountType: inst.accountType,
        repositorySelection: inst.repositorySelection,
        repositoryCount: (inst as any).repos?.length ?? 0,
        installedAt: inst.installedAt.toISOString(),
      })),
      installUrl: config.githubApp.installUrl,
    }, { requestId: request.id });
  });

  /**
   * POST /webhook
   * Handle GitHub App webhooks
   */
  const webhookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    // Check if webhook secret is configured
    if (!config.githubApp.webhookSecret) {
      fastify.log.warn('GitHub App webhook received but webhook secret not configured');
      return reply.status(200).send({ received: true, processed: false });
    }

    // Get headers
    const signature = request.headers['x-hub-signature-256'] as string;
    const event = request.headers['x-github-event'] as string;
    const deliveryId = request.headers['x-github-delivery'] as string;

    if (!signature || !event) {
      throw new BadRequestError('Missing required GitHub webhook headers');
    }

    // Get raw body for signature verification
    const rawBody = (request as any).rawBody as Buffer;
    if (!rawBody) {
      throw new BadRequestError('Missing raw request body');
    }

    // Verify signature
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', config.githubApp.webhookSecret!)
      .update(rawBody)
      .digest('hex')}`;

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      fastify.log.warn({ deliveryId }, 'Invalid GitHub webhook signature');
      throw new ForbiddenError('Invalid webhook signature');
    }

    // Parse payload
    const payload = request.body as GitHubWebhookPayload;

    fastify.log.info({
      event,
      action: payload.action,
      deliveryId,
      installationId: payload.installation?.id,
    }, 'GitHub App webhook received');

    // Handle different events
    try {
      switch (event) {
        case 'installation':
          await handleInstallationEvent(payload, fastify);
          break;

        case 'installation_repositories':
          await handleInstallationRepositoriesEvent(payload, fastify);
          break;

        default:
          fastify.log.debug({ event }, 'Unhandled GitHub webhook event');
      }
    } catch (error) {
      fastify.log.error({ error, event, deliveryId }, 'Error processing GitHub webhook');
      // Don't throw - return 200 to prevent GitHub from retrying
    }

    return reply.status(200).send({ received: true });
  };

  const webhookRouteConfig = {
    config: {
      rawBody: true,
    },
  };

  // Register /webhook endpoint for GitHub App webhooks
  fastify.post('/webhook', webhookRouteConfig, webhookHandler);
}

/**
 * Handle installation.* events
 */
async function handleInstallationEvent(
  payload: GitHubWebhookPayload,
  fastify: FastifyInstance
): Promise<void> {
  const { action, installation, repositories, sender } = payload;

  // Try to find the Keyway user who triggered this
  let installedByUserId: string | undefined;
  if (sender?.id) {
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, sender.id),
    });
    installedByUserId = user?.id;
  }

  switch (action) {
    case 'created':
      fastify.log.info({
        installationId: installation.id,
        account: installation.account.login,
        repoCount: repositories?.length,
      }, 'GitHub App installed');

      await createInstallation({
        installationId: installation.id,
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type.toLowerCase() as InstallationAccountType,
        repositorySelection: installation.repository_selection,
        permissions: installation.permissions,
        repositories: repositories,
        installedByUserId,
      });

      // Log activity if we know who installed it
      if (installedByUserId) {
        await logActivity({
          userId: installedByUserId,
          action: 'github_app_installed',
          platform: 'web',
          metadata: {
            installationId: installation.id,
            accountLogin: installation.account.login,
            accountType: installation.account.type,
            repositorySelection: installation.repository_selection,
            repositoryCount: repositories?.length || 0,
          },
        });
      }
      break;

    case 'deleted':
      fastify.log.info({
        installationId: installation.id,
        account: installation.account.login,
      }, 'GitHub App uninstalled');

      // Log activity before deletion if we know who triggered it
      if (installedByUserId) {
        await logActivity({
          userId: installedByUserId,
          action: 'github_app_uninstalled',
          platform: 'web',
          metadata: {
            installationId: installation.id,
            accountLogin: installation.account.login,
            accountType: installation.account.type,
          },
        });
      }

      await deleteInstallation(installation.id);
      break;

    case 'suspend':
      fastify.log.info({
        installationId: installation.id,
        account: installation.account.login,
      }, 'GitHub App suspended');

      await updateInstallationStatus(installation.id, 'suspended');
      break;

    case 'unsuspend':
      fastify.log.info({
        installationId: installation.id,
        account: installation.account.login,
      }, 'GitHub App unsuspended');

      await updateInstallationStatus(installation.id, 'active');
      break;

    case 'new_permissions_accepted':
      fastify.log.info({
        installationId: installation.id,
        permissions: installation.permissions,
      }, 'GitHub App permissions updated');

      // Update permissions in database
      const existingInstallation = await getInstallationByGitHubId(installation.id);
      if (existingInstallation) {
        await createInstallation({
          installationId: installation.id,
          accountId: installation.account.id,
          accountLogin: installation.account.login,
          accountType: installation.account.type.toLowerCase() as InstallationAccountType,
          repositorySelection: installation.repository_selection,
          permissions: installation.permissions,
        });
      }
      break;

    default:
      fastify.log.debug({ action }, 'Unhandled installation action');
  }
}

/**
 * Handle installation_repositories.* events
 */
async function handleInstallationRepositoriesEvent(
  payload: GitHubWebhookPayload,
  fastify: FastifyInstance
): Promise<void> {
  const { action, installation, repositories_added, repositories_removed } = payload;

  switch (action) {
    case 'added':
      fastify.log.info({
        installationId: installation.id,
        added: repositories_added?.map((r) => r.full_name),
      }, 'Repositories added to GitHub App installation');

      await updateInstallationRepos(
        installation.id,
        repositories_added || [],
        []
      );
      break;

    case 'removed':
      fastify.log.info({
        installationId: installation.id,
        removed: repositories_removed?.map((r) => r.full_name),
      }, 'Repositories removed from GitHub App installation');

      await updateInstallationRepos(
        installation.id,
        [],
        repositories_removed?.map((r) => ({ id: r.id })) || []
      );
      break;

    default:
      fastify.log.debug({ action }, 'Unhandled installation_repositories action');
  }
}
