import { eq, and } from "drizzle-orm";
import { config } from "../config";
import { db, vcsAppInstallations } from "../db";
import type { OrgRole, VcsAppInstallation } from "../db/schema";
import { getOrgMembership } from "./github";
import { githubAccountId, isSameGitHubAccount, type ForgeAccount } from "./forgeAccount";
import { keywayRoleFromGitHub } from "./orgRole";
import { logger } from "./sharedLogger";
import {
  getInstallationToken,
  findOrgInstallationViaGitHubAPI,
  syncInstallationFromAPI,
} from "../services/github-app.service";

/**
 * A Keyway organization as stored: `login` is GitHub's current name and can
 * change (or be re-registered by someone else after a rename); `forgeOrgId` is
 * GitHub's immutable org id and is what identity is bound to.
 */
export interface OrgIdentity {
  login: string;
  forgeOrgId: string;
}

/**
 * Live GitHub answer about a user's membership of an org:
 *  - active: GitHub confirms an active membership, with the mapped Keyway role;
 *  - not_member: GitHub definitively says no (404, or invitation still pending);
 *  - unverifiable: no definitive answer. `app_not_installed`: no Keyway App
 *    installation bound to this org id; `missing_permission`: the App can't read
 *    members (403, Members: read not granted); `unavailable`: GitHub outage,
 *    rate limit or network error. Never treat this as either yes or no.
 */
export type LiveOrgMembership =
  | { status: "active"; role: OrgRole }
  | { status: "not_member" }
  | { status: "unverifiable"; reason: UnverifiableReason };

export type UnverifiableReason = "app_not_installed" | "missing_permission" | "unavailable";

/**
 * Reasons a membership read for a signed-in ACCOUNT can't be verified: the
 * UnverifiableReason ones, plus `account_mismatch` — GitHub's answer for the
 * login Keyway has on file is about a different (or no) GitHub account. Logins
 * can be released and re-registered: the user renamed since signing in to
 * Keyway (signing in again refreshes the login). Never "not a member": the
 * user's own membership was not read, so nothing cached may be dropped for it.
 */
export type LiveOrgUnverifiableReason = UnverifiableReason | "account_mismatch";

/** LiveOrgMembership for a signed-in account (see readLiveOrgMembership). */
export type LiveOrgAccountMembership =
  | { status: "active"; role: OrgRole }
  | { status: "not_member" }
  | { status: "unverifiable"; reason: LiveOrgUnverifiableReason };

function githubOrgId(org: OrgIdentity): number | null {
  const id = Number(org.forgeOrgId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The active Keyway App installation on THIS GitHub org, matched by GitHub's
 * immutable account id (DB first, then the GitHub API by login, accepted only
 * when its account id matches). Returns null when none is bound to the org id.
 */
async function findOrgInstallation(org: OrgIdentity): Promise<VcsAppInstallation | null> {
  const accountId = githubOrgId(org);
  if (accountId === null) {
    return null;
  }
  const stored = await db.query.vcsAppInstallations.findFirst({
    where: and(
      eq(vcsAppInstallations.accountId, accountId),
      eq(vcsAppInstallations.accountType, "organization"),
      eq(vcsAppInstallations.status, "active")
    ),
  });
  if (stored) {
    return stored.accountId === accountId ? stored : null;
  }
  // Webhook may have been missed. GitHub resolves the LOGIN, which after a rename
  // can name a different org: only accept the installation if its id matches.
  const fromApi = await findOrgInstallationViaGitHubAPI(org.login);
  if (!fromApi) {
    return null;
  }
  if (fromApi.accountId !== accountId) {
    logger.warn(
      { orgLogin: org.login, forgeOrgId: org.forgeOrgId, installationAccountId: fromApi.accountId },
      "Org login now belongs to a different GitHub org; ignoring its installation"
    );
    return null;
  }
  await syncInstallationFromAPI(fromApi);
  return fromApi;
}

/**
 * Get an App installation token for the org (bound by GitHub org id, see
 * findOrgInstallation). Returns null if the Keyway App isn't installed on that
 * org or the token can't be minted.
 */
export async function getOrgInstallationToken(org: OrgIdentity): Promise<string | null> {
  const installation = await findOrgInstallation(org);
  if (!installation) {
    return null;
  }
  try {
    return await getInstallationToken(installation.installationId);
  } catch {
    return null;
  }
}

/**
 * Tell GitHub's definitive "not a member" (404) from "can't tell" (403 without
 * the Members permission, rate limit, 5xx, network). getOrgMembership() folds
 * all of them into null.
 */
async function classifyMissingMembership(
  installToken: string,
  orgLogin: string,
  username: string
): Promise<LiveOrgMembership> {
  const apiBase = config.github?.apiBaseUrl || "https://api.github.com";
  let response: Response;
  try {
    response = await fetch(
      `${apiBase}/orgs/${encodeURIComponent(orgLogin)}/memberships/${encodeURIComponent(username)}`,
      {
        headers: {
          Authorization: `Bearer ${installToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
  } catch {
    return { status: "unverifiable", reason: "unavailable" };
  }
  if (response.status === 404) {
    return { status: "not_member" };
  }
  const rateLimited =
    response.status === 429 ||
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.has("retry-after");
  if (response.status === 403 && !rateLimited) {
    return { status: "unverifiable", reason: "missing_permission" };
  }
  return { status: "unverifiable", reason: "unavailable" };
}

/**
 * Does `username` still name the GitHub account `userId`? Asked before turning a
 * membership 404 into "not a member": the 404 may be about whoever holds the
 * login now (or about nobody, once it is released), not about our user.
 */
async function loginStillNamesAccount(
  installToken: string,
  username: string,
  userId: string
): Promise<"same" | "different" | "unknown"> {
  const apiBase = config.github?.apiBaseUrl || "https://api.github.com";
  try {
    const response = await fetch(`${apiBase}/users/${encodeURIComponent(username)}`, {
      headers: {
        Authorization: `Bearer ${installToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (response.status === 404) {
      return "different";
    }
    if (!response.ok) {
      return "unknown";
    }
    const user = (await response.json()) as { id?: unknown };
    return isSameGitHubAccount(userId, user) ? "same" : "different";
  } catch {
    return "unknown";
  }
}

/**
 * Read the user's membership of the org LIVE from GitHub, via the App
 * INSTALLATION token (Members: Read) bound to the org's immutable id — the
 * user-to-server token does not reliably report the admin role. The account
 * must come from the authenticated session, never from the request.
 *
 * GitHub is asked by login, but the answer counts only when it is about
 * `account.forgeUserId` (the membership's `user.id`; behind a 404, the login's
 * current owner): otherwise `unverifiable` / `account_mismatch`.
 *
 * Uncached: one to three GitHub round-trips per call, keep it off hot paths.
 */
export async function readLiveOrgMembership(
  org: OrgIdentity,
  account: ForgeAccount
): Promise<LiveOrgAccountMembership> {
  // A login alone is never enough: it can be released and re-registered by someone else
  const userId = typeof account === "object" && account ? githubAccountId(account) : null;
  if (userId === null) {
    return { status: "unverifiable", reason: "account_mismatch" };
  }
  const username = account.username;
  const accountId = githubOrgId(org);
  if (accountId === null) {
    return { status: "unverifiable", reason: "app_not_installed" };
  }
  let installation: VcsAppInstallation | null;
  try {
    installation = await findOrgInstallation(org);
  } catch {
    return { status: "unverifiable", reason: "unavailable" };
  }
  if (!installation) {
    return { status: "unverifiable", reason: "app_not_installed" };
  }
  let token: string;
  try {
    token = await getInstallationToken(installation.installationId);
  } catch {
    return { status: "unverifiable", reason: "unavailable" };
  }

  let live: Awaited<ReturnType<typeof getOrgMembership>>;
  try {
    live = await getOrgMembership(token, org.login, username);
  } catch {
    return { status: "unverifiable", reason: "unavailable" };
  }
  if (!live) {
    const missing = await classifyMissingMembership(token, org.login, username);
    if (missing.status !== "not_member" || userId === null) {
      return missing;
    }
    const owner = await loginStillNamesAccount(token, username, userId);
    if (owner === "same") {
      return missing;
    }
    if (owner === "different") {
      logger.warn(
        { orgLogin: org.login, username, forgeUserId: userId },
        "Stored login now names a different GitHub account; membership not verified"
      );
      return { status: "unverifiable", reason: "account_mismatch" };
    }
    return { status: "unverifiable", reason: "unavailable" };
  }
  // The token is scoped to the bound org, so GitHub answering about another org
  // means the login no longer names it: no answer about OUR org.
  if (live.organization && live.organization.id !== accountId) {
    return { status: "unverifiable", reason: "app_not_installed" };
  }
  // GitHub answered for whoever holds the login today: about OUR user only if the
  // id matches. Checked before the state, so another account's pending invite is
  // never read as "our user is not a member".
  if (userId !== null && !isSameGitHubAccount(userId, live.user)) {
    logger.warn(
      { orgLogin: org.login, username, forgeUserId: userId, answeredFor: live.user?.id ?? null },
      "Org membership is for a different GitHub account than the signed-in user"
    );
    return { status: "unverifiable", reason: "account_mismatch" };
  }
  if (live.state !== "active") {
    return { status: "not_member" };
  }
  return { status: "active", role: keywayRoleFromGitHub(live.role) };
}

/**
 * Read the caller's org role LIVE from GitHub. `organization_members.org_role`
 * is only a mirror, and GitHub sends no webhook when an admin is demoted, so a
 * cached "owner" row must never grant on its own.
 *
 * Returns null when the role can't be determined (App not installed on the org
 * bound to `org.forgeOrgId`, caller not an active member, GitHub's answer is for
 * another account, GitHub unreachable) — callers treat null as "not an admin".
 */
export async function getLiveOrgRole(
  org: OrgIdentity,
  account: ForgeAccount
): Promise<OrgRole | null> {
  try {
    const live = await readLiveOrgMembership(org, account);
    return live.status === "active" ? live.role : null;
  } catch {
    return null;
  }
}

/** True only when GitHub confirms, right now, that the account is an active org admin. */
export async function isLiveOrgAdmin(org: OrgIdentity, account: ForgeAccount): Promise<boolean> {
  return (await getLiveOrgRole(org, account)) === "owner";
}
