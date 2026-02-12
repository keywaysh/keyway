import { db, users } from "../db";
import { eq, and } from "drizzle-orm";
import type { ForgeType } from "../db/schema";
import { ForbiddenError } from "../lib";

/**
 * VCS user info from authentication middleware
 */
export interface VcsUser {
  forgeType: ForgeType;
  forgeUserId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * User from database
 */
export type DbUser = NonNullable<Awaited<ReturnType<typeof db.query.users.findFirst>>>;

/**
 * Look up a user in the database from VCS user info
 * Returns null if user doesn't exist
 */
export async function getUserFromVcsUser(vcsUser: VcsUser): Promise<DbUser | null> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.forgeType, vcsUser.forgeType), eq(users.forgeUserId, vcsUser.forgeUserId)),
  });
  return user ?? null;
}

/**
 * Look up a user in the database from VCS user info
 * Throws ForbiddenError if user doesn't exist
 */
export async function getOrThrowUser(vcsUser: VcsUser): Promise<DbUser> {
  const user = await getUserFromVcsUser(vcsUser);
  if (!user) {
    throw new ForbiddenError("User not found in database");
  }
  return user;
}

/**
 * Extract VCS user from request (handles both vcsUser and deprecated githubUser)
 */
export function extractVcsUser(request: { vcsUser?: VcsUser; githubUser?: VcsUser }): VcsUser {
  const vcsUser = request.vcsUser || request.githubUser;
  if (!vcsUser) {
    throw new ForbiddenError("No VCS user info found in request");
  }
  return vcsUser;
}
