import { BadRequestError } from "../lib";

/** A GitHub owner or repository name. "." and ".." are never valid names. */
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function isValidRepoSegment(segment: unknown): segment is string {
  return (
    typeof segment === "string" &&
    REPO_SEGMENT_PATTERN.test(segment) &&
    segment !== "." &&
    segment !== ".."
  );
}

export function isValidRepoFullName(repoFullName: unknown): repoFullName is string {
  if (typeof repoFullName !== "string") {
    return false;
  }
  const parts = repoFullName.split("/");
  return parts.length === 2 && isValidRepoSegment(parts[0]) && isValidRepoSegment(parts[1]);
}

/**
 * Split "owner/repo", rejecting anything that is not exactly two safe segments.
 *
 * Repo names come from user input and end up in GitHub API URLs; fetch() resolves
 * "..", "\" and similar before GitHub sees the path, so an unchecked name can make a
 * permission check run against a different repository than the one Keyway stores.
 * @throws BadRequestError on an invalid name
 */
export function parseRepoFullName(repoFullName: string): { owner: string; repo: string } {
  if (!isValidRepoFullName(repoFullName)) {
    throw new BadRequestError("Invalid repository name");
  }
  const [owner, repo] = repoFullName.split("/");
  return { owner, repo };
}
