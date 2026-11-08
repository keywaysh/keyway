import type { FastifyRequest } from "fastify";
import { BadRequestError } from "../lib";
import { isValidRepoFullName, isValidRepoSegment } from "../utils/repoName";

/** Path params that hold a single GitHub owner, repo, org or user name. */
const NAME_PARAMS = ["owner", "repo", "org", "username"] as const;

/**
 * preValidation hook: reject repository / org / user names that are not plain
 * GitHub names before any handler, middleware or GitHub API call sees them.
 *
 * The router decodes %2F, %5C, %2E… inside path params, and these names end up in
 * GitHub API URLs where "..", "\" or "?" would change which resource is checked.
 */
export async function validateRepoInput(request: FastifyRequest): Promise<void> {
  const params = (request.params ?? {}) as Record<string, unknown>;
  for (const name of NAME_PARAMS) {
    if (name in params && !isValidRepoSegment(params[name])) {
      throw new BadRequestError(`Invalid ${name} name`);
    }
  }

  const query = (request.query ?? {}) as Record<string, unknown>;
  if ("repo" in query && !isValidRepoFullName(query.repo)) {
    throw new BadRequestError("Invalid repository name");
  }

  const body = request.body as Record<string, unknown> | null | undefined;
  if (body && typeof body === "object" && "repoFullName" in body) {
    if (!isValidRepoFullName(body.repoFullName)) {
      throw new BadRequestError("Invalid repository name");
    }
  }
}
