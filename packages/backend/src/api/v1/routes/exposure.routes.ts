import { FastifyInstance } from "fastify";
import { authenticateGitHub, requireApiKeyScope } from "../../../middleware/auth";
import { db, users, vaults, type UserPlan } from "../../../db";
import { sendData, NotFoundError, ForbiddenError } from "../../../lib";
import { eq, and } from "drizzle-orm";
import {
  getExposureForUser,
  getExposureForOrg,
  getSecretAccessHistory,
} from "../../../services/exposure.service";
import {
  getOrganizationByLogin,
  getOrganizationById,
} from "../../../services/organization.service";
import { isLiveOrgAdmin } from "../../../utils/orgAdmin";
import { getUserRoleWithApp } from "../../../utils/github";
import { getEffectivePlanWithTrial, getEffectivePlanForUser } from "../../../services/trial.service";
import { hasExposureAccess } from "../../../config/plans";
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
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
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

      // Only org owners can view exposure reports. Checked LIVE on GitHub (the
      // cached org_role isn't refreshed when an admin is demoted), bound to the
      // org's immutable GitHub id (its login can be re-registered after a rename).
      const isOwner = await isLiveOrgAdmin(org, vcsUser.username);
      if (!isOwner) {
        throw new ForbiddenError("Only organization owners can view exposure reports");
      }

      const effectivePlan = getEffectivePlanWithTrial(org);
      if (!hasExposureAccess(effectivePlan)) {
        throw new PlanLimitError(
          "Exposure reports require the Business plan. Upgrade to track which secrets your team members have accessed."
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
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
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

      // Only org owners can view exposure reports. Checked LIVE on GitHub (the
      // cached org_role isn't refreshed when an admin is demoted), bound to the
      // org's immutable GitHub id (its login can be re-registered after a rename).
      const isOwner = await isLiveOrgAdmin(org, vcsUser.username);
      if (!isOwner) {
        throw new ForbiddenError("Only organization owners can view exposure reports");
      }

      const effectivePlan = getEffectivePlanWithTrial(org);
      if (!hasExposureAccess(effectivePlan)) {
        throw new PlanLimitError(
          "Exposure reports require the Business plan. Upgrade to track which secrets your team members have accessed."
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
      preHandler: [authenticateGitHub, requireApiKeyScope("read:secrets")],
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

      const org = vault.orgId ? await getOrganizationById(vault.orgId) : null;

      // Access history is for CURRENT admins, checked live: having created the vault
      // doesn't count once the user lost admin on the repo, and the cached org_role
      // isn't refreshed when an org admin is demoted.
      const repoRole = await getUserRoleWithApp(vault.repoFullName, vcsUser.username, {
        expectedRepoId: vault.forgeRepoId,
      }).catch(() => null);
      if (repoRole !== "admin") {
        const isOrgAdmin =
          vault.orgId && org ? await isLiveOrgAdmin(org, vcsUser.username) : false;
        if (!isOrgAdmin) {
          throw new ForbiddenError(
            "Only repository or organization admins can view access history"
          );
        }
      }

      let effectivePlan: UserPlan = "free";
      if (vault.orgId) {
        if (org) {
          effectivePlan = getEffectivePlanWithTrial(org);
        }
      } else {
        effectivePlan = await getEffectivePlanForUser(user.id);
      }
      if (!hasExposureAccess(effectivePlan)) {
        throw new PlanLimitError(
          "Exposure reports require the Business plan. Upgrade to track which secrets your team members have accessed."
        );
      }

      // Scoped to this vault: a secretId from another vault returns nothing
      const accessHistory = await getSecretAccessHistory(secretId, vault.id, {
        limit: Math.min(Math.max(parseInt(limit ?? "", 10) || 50, 1), 200),
        offset: Math.max(parseInt(offset ?? "", 10) || 0, 0),
      });

      return sendData(reply, accessHistory, { requestId: request.id });
    }
  );
}
