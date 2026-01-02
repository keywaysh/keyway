import { FastifyInstance } from "fastify";
import { authenticateGitHub } from "../../../middleware/auth";
import { db, users, vaults } from "../../../db";
import { sendData, NotFoundError, ForbiddenError } from "../../../lib";
import { eq, and } from "drizzle-orm";
import {
  getExposureForUser,
  getExposureForOrg,
  getSecretAccessHistory,
} from "../../../services/exposure.service";
import {
  getOrganizationByLogin,
  isOrganizationOwner,
} from "../../../services/organization.service";
import { getEffectivePlanWithTrial } from "../../../services/trial.service";
import { PlanLimitError } from "../../../lib";

/**
 * Exposure routes - Track which secrets users have accessed
 * Enables offboarding: "Dev leaves? You know exactly what to rotate."
 *
 * GET /api/v1/orgs/:org/exposure - Org-level exposure summary
 * GET /api/v1/orgs/:org/exposure/:username - User exposure report
 * GET /api/v1/vaults/:owner/:repo/secrets/:secretId/access-history - Secret access history
 */
export async function exposureRoutes(fastify: FastifyInstance) {
  /**
   * GET /orgs/:org/exposure
   * Get org-level exposure summary (org owner/admin only)
   */
  fastify.get<{
    Params: { org: string };
    Querystring: {
      startDate?: string;
      endDate?: string;
      vaultId?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    "/orgs/:org/exposure",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { org: orgLogin } = request.params;
      const { startDate, endDate, vaultId, limit, offset } = request.query;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get organization
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Only org owners can view exposure reports
      const isOwner = await isOrganizationOwner(org.id, user.id);
      if (!isOwner) {
        throw new ForbiddenError("Only organization owners can view exposure reports");
      }

      // Exposure reports require Team plan
      const effectivePlan = getEffectivePlanWithTrial(org);
      if (effectivePlan !== "team") {
        throw new PlanLimitError(
          "Exposure reports require a Team plan. Upgrade to track which secrets your team members have accessed."
        );
      }

      // Build org repo prefix for filtering (e.g., "myorg/")
      const orgRepoPrefix = `${orgLogin}/`;

      const exposureData = await getExposureForOrg(orgRepoPrefix, {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        vaultId: vaultId || undefined,
        limit: limit ? parseInt(limit, 10) : 100,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      return sendData(reply, exposureData, { requestId: request.id });
    }
  );

  /**
   * GET /orgs/:org/exposure/:username
   * Get exposure report for a specific user (org owner/admin only)
   */
  fastify.get<{
    Params: { org: string; username: string };
  }>(
    "/orgs/:org/exposure/:username",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { org: orgLogin, username } = request.params;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get organization
      const org = await getOrganizationByLogin(orgLogin);
      if (!org) {
        throw new NotFoundError("Organization not found");
      }

      // Only org owners can view exposure reports
      const isOwner = await isOrganizationOwner(org.id, user.id);
      if (!isOwner) {
        throw new ForbiddenError("Only organization owners can view exposure reports");
      }

      // Exposure reports require Team plan
      const effectivePlan = getEffectivePlanWithTrial(org);
      if (effectivePlan !== "team") {
        throw new PlanLimitError(
          "Exposure reports require a Team plan. Upgrade to track which secrets your team members have accessed."
        );
      }

      // Build org repo prefix for filtering
      const orgRepoPrefix = `${orgLogin}/`;

      const exposureReport = await getExposureForUser(username, orgRepoPrefix);

      if (!exposureReport) {
        throw new NotFoundError(
          `No access records found for user "${username}" in organization "${orgLogin}"`
        );
      }

      return sendData(reply, exposureReport, { requestId: request.id });
    }
  );

  /**
   * GET /vaults/:owner/:repo/secrets/:secretId/access-history
   * Get access history for a specific secret (vault admin only)
   */
  fastify.get<{
    Params: { owner: string; repo: string; secretId: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    "/vaults/:owner/:repo/secrets/:secretId/access-history",
    {
      preHandler: [authenticateGitHub],
    },
    async (request, reply) => {
      const { owner, repo, secretId } = request.params;
      const { limit, offset } = request.query;
      const repoFullName = `${owner}/${repo}`;
      const vcsUser = request.vcsUser || request.githubUser!;

      // Get user from database
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.forgeType, vcsUser.forgeType),
          eq(users.forgeUserId, vcsUser.forgeUserId)
        ),
      });

      if (!user) {
        throw new ForbiddenError("User not found");
      }

      // Get vault
      const vault = await db.query.vaults.findFirst({
        where: eq(vaults.repoFullName, repoFullName),
      });

      if (!vault) {
        throw new NotFoundError("Vault not found");
      }

      // For now, require the user to be the vault owner
      // TODO: Use getUserRoleWithApp to check if user is admin
      if (vault.ownerId !== user.id) {
        // Check if this is an org vault and user is org owner
        if (vault.orgId) {
          const isOwner = await isOrganizationOwner(vault.orgId, user.id);
          if (!isOwner) {
            throw new ForbiddenError("Only vault/organization owners can view access history");
          }
        } else {
          throw new ForbiddenError("Only vault owners can view access history");
        }
      }

      const accessHistory = await getSecretAccessHistory(secretId, {
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      return sendData(reply, accessHistory, { requestId: request.id });
    }
  );
}
