import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as crypto from "crypto";
import { z } from "zod";
import { config } from "../../../config";
import { authenticateGitHub } from "../../../middleware/auth";
import {
  checkInstallationStatus,
  createInstallation,
  deleteInstallation,
  updateInstallationStatus,
  updateInstallationRepos,
  getInstallationsForUser,
  getInstallationByGitHubId,
  logActivity,
  getInstallationToken,
} from "../../../services";
import { db, users, vcsAppInstallations } from "../../../db";
import { eq, and } from "drizzle-orm";
import { sendData } from "../../../lib/response";
import { BadRequestError, ForbiddenError } from "../../../lib/errors";
import type { InstallationAccountType } from "../../../db/schema";
import {
  getOrCreateOrganization,
  syncOrganizationMembers,
  getOrganizationByLogin,
} from "../../../services/organization.service";
import { listOrgMembersWithApp, listUserOrganizations } from "../../../utils/github";
import { decryptAccessToken } from "../../../utils/tokenEncryption";

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
    type: "User" | "Organization";
  };
  repository_selection: "all" | "selected";
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
  fastify.post(
    "/check-installation",
    {
      preHandler: [authenticateGitHub],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = CheckInstallationSchema.parse(request.body);

      const status = await checkInstallationStatus(body.repoOwner, body.repoName);

      return sendData(reply, status, { requestId: request.id });
    }
  );

  /**
   * GET /installations
   * List all GitHub App installations for the authenticated user
   */
  fastify.get(
    "/installations",
    {
      preHandler: [authenticateGitHub],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const vcsUser = request.vcsUser || request.githubUser;
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser!.forgeType),
          eq(users.forgeUserId, vcsUser!.forgeUserId)
        ),
      });

      if (!user) {
        return sendData(reply, { installations: [] }, { requestId: request.id });
      }

      const installations = await getInstallationsForUser(user.id);

      return sendData(
        reply,
        {
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
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /available-orgs
   * List GitHub organizations where the user is a member, with their status
   * Status can be: 'ready' (app installed), 'needs_install' (user is admin), 'contact_admin' (user is member)
   */
  fastify.get(
    "/available-orgs",
    {
      preHandler: [authenticateGitHub],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const vcsUser = request.vcsUser || request.githubUser;

      // Get the user from database to get their encrypted token
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser!.forgeType),
          eq(users.forgeUserId, vcsUser!.forgeUserId)
        ),
      });

      if (!user) {
        return sendData(reply, { organizations: [] }, { requestId: request.id });
      }

      // Decrypt the user's GitHub token to list their orgs
      const accessToken = await decryptAccessToken({
        encryptedAccessToken: user.encryptedAccessToken,
        accessTokenIv: user.accessTokenIv,
        accessTokenAuthTag: user.accessTokenAuthTag,
        tokenEncryptionVersion: user.tokenEncryptionVersion,
      });
      if (!accessToken) {
        return sendData(reply, { organizations: [] }, { requestId: request.id });
      }

      // List orgs where the GitHub App is installed and user has access
      // Note: This uses /user/installations, so all returned orgs have the app installed
      const githubOrgs = await listUserOrganizations(accessToken);

      // Check which orgs are already connected to Keyway
      const orgLoginLookups = await Promise.all(
        githubOrgs.map(async (org) => {
          const keywayOrg = await getOrganizationByLogin(org.login);
          return { login: org.login, connected: !!keywayOrg };
        })
      );
      const connectedOrgs = new Map(
        orgLoginLookups.map((o) => [o.login.toLowerCase(), o.connected])
      );

      // Build the response - all orgs are "ready" since they come from /user/installations
      const organizations = githubOrgs.map((org) => {
        const isConnected = connectedOrgs.get(org.login.toLowerCase()) ?? false;

        return {
          login: org.login,
          display_name: org.login,
          avatar_url: org.avatar_url,
          status: "ready" as const, // App is installed on all returned orgs
          user_role: org.role,
          already_connected: isConnected,
        };
      });

      return sendData(
        reply,
        {
          organizations,
          install_url: config.githubApp.installUrl,
        },
        { requestId: request.id }
      );
    }
  );

  /**
   * GET /repo-ids
   * Get GitHub repository IDs for deep linking during GitHub App installation
   * Uses existing "all repos" installation token if available
   */
  fastify.get("/repo-ids", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { repo?: string };
    if (!query.repo) {
      throw new BadRequestError("repo parameter required");
    }

    const [owner, repo] = query.repo.split("/");
    if (!owner || !repo) {
      throw new BadRequestError("Invalid repo format. Expected: owner/repo");
    }

    // Chercher une installation "all repos" active pour cet owner
    const installation = await db.query.vcsAppInstallations.findFirst({
      where: and(
        eq(vcsAppInstallations.accountLogin, owner),
        eq(vcsAppInstallations.repositorySelection, "all"),
        eq(vcsAppInstallations.status, "active")
      ),
    });

    if (!installation) {
      // Pas d'installation existante - retourner null (le CLI fera fallback vers API publique)
      return sendData(reply, { ownerId: null, repoId: null }, { requestId: request.id });
    }

    try {
      // Utiliser le token d'installation pour récupérer les IDs du repo
      const token = await getInstallationToken(installation.installationId);
      const response = await fetch(`${config.github.apiBaseUrl}/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Keyway-Backend",
        },
      });

      if (!response.ok) {
        // Repo privé non accessible ou n'existe pas
        return sendData(reply, { ownerId: null, repoId: null }, { requestId: request.id });
      }

      const data = (await response.json()) as { id: number; owner: { id: number } };
      return sendData(
        reply,
        {
          ownerId: data.owner.id,
          repoId: data.id,
        },
        { requestId: request.id }
      );
    } catch (error) {
      fastify.log.warn({ error, owner, repo }, "Failed to fetch repo IDs");
      return sendData(reply, { ownerId: null, repoId: null }, { requestId: request.id });
    }
  });

  /**
   * POST /webhook
   * Handle GitHub App webhooks
   */
  const webhookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    // SECURITY: Webhook secret is required to validate incoming webhooks
    // This prevents attackers from forging webhook events
    if (!config.githubApp.webhookSecret) {
      fastify.log.error(
        "GitHub App webhook received but webhook secret not configured - rejecting for security"
      );
      return reply.status(503).send({
        type: "https://keyway.sh/errors/service-unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Webhook endpoint is not properly configured",
      });
    }

    // Get headers
    const signature = request.headers["x-hub-signature-256"] as string;
    const event = request.headers["x-github-event"] as string;
    const deliveryId = request.headers["x-github-delivery"] as string;

    if (!signature || !event) {
      throw new BadRequestError("Missing required GitHub webhook headers");
    }

    // Get raw body for signature verification
    const rawBody = (request as any).rawBody as Buffer;
    if (!rawBody) {
      throw new BadRequestError("Missing raw request body");
    }

    // Verify signature
    const expectedSignature = `sha256=${crypto
      .createHmac("sha256", config.githubApp.webhookSecret!)
      .update(rawBody)
      .digest("hex")}`;

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      fastify.log.warn({ deliveryId }, "Invalid GitHub webhook signature");
      throw new ForbiddenError("Invalid webhook signature");
    }

    // Parse payload
    const payload = request.body as GitHubWebhookPayload;

    fastify.log.info(
      {
        event,
        action: payload.action,
        deliveryId,
        installationId: payload.installation?.id,
      },
      "GitHub App webhook received"
    );

    // Handle different events
    try {
      switch (event) {
        case "installation":
          await handleInstallationEvent(payload, fastify);
          break;

        case "installation_repositories":
          await handleInstallationRepositoriesEvent(payload, fastify);
          break;

        case "organization":
          await handleOrganizationEvent(payload, fastify);
          break;

        case "membership":
          await handleMembershipEvent(payload, fastify);
          break;

        default:
          fastify.log.debug({ event }, "Unhandled GitHub webhook event");
      }
    } catch (error) {
      fastify.log.error({ error, event, deliveryId }, "Error processing GitHub webhook");
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
  fastify.post("/webhook", webhookRouteConfig, webhookHandler);
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
      where: and(eq(users.forgeType, "github"), eq(users.forgeUserId, String(sender.id))),
    });
    installedByUserId = user?.id;
  }

  switch (action) {
    case "created":
      fastify.log.info(
        {
          installationId: installation.id,
          account: installation.account.login,
          repoCount: repositories?.length,
        },
        "GitHub App installed"
      );

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

      // If installed on an organization, create/update org and sync members
      if (installation.account.type === "Organization") {
        try {
          const org = await getOrCreateOrganization(
            "github",
            String(installation.account.id),
            installation.account.login
          );

          fastify.log.info(
            {
              orgId: org.id,
              orgLogin: org.login,
            },
            "Created/updated organization from GitHub App installation"
          );

          // Sync organization members
          const githubMembers = await listOrgMembersWithApp(
            installation.id,
            installation.account.login
          );

          if (githubMembers.length > 0) {
            // Convert GitHub members to VCS format (id as string)
            const vcsMembers = githubMembers.map((m) => ({
              id: String(m.id),
              login: m.login,
              avatar_url: m.avatar_url,
              role: m.role,
            }));
            const result = await syncOrganizationMembers(org.id, "github", vcsMembers);
            fastify.log.info(
              {
                orgId: org.id,
                added: result.added,
                updated: result.updated,
                removed: result.removed,
              },
              "Synced organization members"
            );
          }
        } catch (error) {
          // Log but don't fail the webhook
          fastify.log.error(
            {
              error: error instanceof Error ? error.message : "Unknown",
              installationId: installation.id,
            },
            "Failed to create organization from installation"
          );
        }
      }

      // Log activity if we know who installed it
      if (installedByUserId) {
        await logActivity({
          userId: installedByUserId,
          action: "vcs_app_installed",
          platform: "web",
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

    case "deleted":
      fastify.log.info(
        {
          installationId: installation.id,
          account: installation.account.login,
        },
        "GitHub App uninstalled"
      );

      // Log activity before deletion if we know who triggered it
      if (installedByUserId) {
        await logActivity({
          userId: installedByUserId,
          action: "vcs_app_uninstalled",
          platform: "web",
          metadata: {
            installationId: installation.id,
            accountLogin: installation.account.login,
            accountType: installation.account.type,
          },
        });
      }

      await deleteInstallation(installation.id);
      break;

    case "suspend":
      fastify.log.info(
        {
          installationId: installation.id,
          account: installation.account.login,
        },
        "GitHub App suspended"
      );

      await updateInstallationStatus(installation.id, "suspended");
      break;

    case "unsuspend":
      fastify.log.info(
        {
          installationId: installation.id,
          account: installation.account.login,
        },
        "GitHub App unsuspended"
      );

      await updateInstallationStatus(installation.id, "active");
      break;

    case "new_permissions_accepted": {
      fastify.log.info(
        {
          installationId: installation.id,
          permissions: installation.permissions,
        },
        "GitHub App permissions updated"
      );

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
    }

    default:
      fastify.log.debug({ action }, "Unhandled installation action");
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
    case "added":
      fastify.log.info(
        {
          installationId: installation.id,
          added: repositories_added?.map((r) => r.full_name),
        },
        "Repositories added to GitHub App installation"
      );

      await updateInstallationRepos(installation.id, repositories_added || [], []);
      break;

    case "removed":
      fastify.log.info(
        {
          installationId: installation.id,
          removed: repositories_removed?.map((r) => r.full_name),
        },
        "Repositories removed from GitHub App installation"
      );

      await updateInstallationRepos(
        installation.id,
        [],
        repositories_removed?.map((r) => ({ id: r.id })) || []
      );
      break;

    default:
      fastify.log.debug({ action }, "Unhandled installation_repositories action");
  }
}

// Payload types for organization events
interface GitHubOrganizationPayload {
  action: "member_added" | "member_removed" | "member_invited";
  membership?: {
    user: {
      id: number;
      login: string;
    };
    role: "admin" | "member";
    state: "active" | "pending";
  };
  organization: {
    id: number;
    login: string;
    avatar_url: string;
  };
  installation?: GitHubWebhookInstallation;
}

interface GitHubMembershipPayload {
  action: "added" | "removed";
  member: {
    id: number;
    login: string;
  };
  team?: {
    id: number;
    name: string;
  };
  organization: {
    id: number;
    login: string;
  };
  installation?: GitHubWebhookInstallation;
}

/**
 * Handle organization.* events (member_added, member_removed)
 */
async function handleOrganizationEvent(payload: unknown, fastify: FastifyInstance): Promise<void> {
  const orgPayload = payload as GitHubOrganizationPayload;
  const { action, membership, organization, installation } = orgPayload;

  if (!organization || !installation) {
    return;
  }

  // Find our org by GitHub org ID
  const { getOrganizationByLogin } = await import("../../../services/organization.service");
  const org = await getOrganizationByLogin(organization.login);

  if (!org) {
    fastify.log.debug({ orgLogin: organization.login }, "Organization not found in Keyway");
    return;
  }

  switch (action) {
    case "member_added":
      if (membership) {
        fastify.log.info(
          {
            orgLogin: organization.login,
            member: membership.user.login,
            role: membership.role,
          },
          "Organization member added"
        );

        // Find the Keyway user by GitHub ID
        const newMember = await db.query.users.findFirst({
          where: and(
            eq(users.forgeType, "github"),
            eq(users.forgeUserId, String(membership.user.id))
          ),
        });

        if (newMember) {
          const { upsertOrganizationMember } =
            await import("../../../services/organization.service");
          await upsertOrganizationMember(
            org.id,
            newMember.id,
            membership.role === "admin" ? "owner" : "member",
            membership.state
          );
        }
      }
      break;

    case "member_removed":
      if (membership) {
        fastify.log.info(
          {
            orgLogin: organization.login,
            member: membership.user.login,
          },
          "Organization member removed"
        );

        // Find the Keyway user by GitHub ID
        const removedMember = await db.query.users.findFirst({
          where: and(
            eq(users.forgeType, "github"),
            eq(users.forgeUserId, String(membership.user.id))
          ),
        });

        if (removedMember) {
          const { removeOrganizationMember } =
            await import("../../../services/organization.service");
          await removeOrganizationMember(org.id, removedMember.id);
        }
      }
      break;

    default:
      fastify.log.debug({ action }, "Unhandled organization action");
  }
}

/**
 * Handle membership.* events (role changes)
 */
async function handleMembershipEvent(payload: unknown, fastify: FastifyInstance): Promise<void> {
  const membershipPayload = payload as GitHubMembershipPayload;
  const { action, member, organization, installation } = membershipPayload;

  if (!organization || !installation || !member) {
    return;
  }

  // Only handle if it's an org-level membership change (not team)
  if (membershipPayload.team) {
    return;
  }

  const { getOrganizationByLogin } = await import("../../../services/organization.service");
  const org = await getOrganizationByLogin(organization.login);

  if (!org) {
    return;
  }

  // For role changes, we need to re-sync the member
  // The membership event doesn't include the new role directly,
  // so we fetch from GitHub API
  if (action === "added" || action === "removed") {
    fastify.log.info(
      {
        orgLogin: organization.login,
        member: member.login,
        action,
      },
      "Membership change detected, syncing members"
    );

    // Re-sync all members to get latest roles
    const githubMembers = await listOrgMembersWithApp(installation.id, organization.login);
    if (githubMembers.length > 0) {
      // Convert GitHub members to VCS format (id as string)
      const vcsMembers = githubMembers.map((m) => ({
        id: String(m.id),
        login: m.login,
        avatar_url: m.avatar_url,
        role: m.role,
      }));
      const result = await syncOrganizationMembers(org.id, "github", vcsMembers);
      fastify.log.info(
        {
          orgId: org.id,
          added: result.added,
          updated: result.updated,
          removed: result.removed,
        },
        "Re-synced organization members after membership change"
      );
    }
  }
}
