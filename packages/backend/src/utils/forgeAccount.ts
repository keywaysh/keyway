import type { ForgeType } from "../db/schema";

/**
 * The signed-in forge account a role or membership check is about.
 *
 * `username` is only how GitHub's API addresses the account: GitHub lets a login
 * be released and re-registered by someone else, and Keyway's stored login can
 * be stale, so a login-addressed answer may describe a different person. Every
 * grant is therefore bound to `forgeUserId`, GitHub's immutable user id.
 */
export interface ForgeAccount {
  username: string;
  forgeUserId: string;
  /** When given, anything but "github" grants nothing (ids are per-forge). */
  forgeType?: ForgeType;
}

/** The account's GitHub user id, or null when it can't be bound to one (fail closed). */
export function githubAccountId(account: ForgeAccount): string | null {
  if (account.forgeType !== undefined && account.forgeType !== "github") {
    return null;
  }
  const id = account.forgeUserId;
  return typeof id === "string" && /^[1-9][0-9]*$/.test(id) ? id : null;
}

/** True only when a GitHub answer names the account `accountId` by its immutable id. */
export function isSameGitHubAccount(
  accountId: string,
  user: { id?: unknown } | null | undefined
): boolean {
  const id = user?.id;
  return (typeof id === "number" || typeof id === "string") && String(id) === accountId;
}
