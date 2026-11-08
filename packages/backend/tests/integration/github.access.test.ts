import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import * as crypto from "crypto";

/**
 * Regression tests for /v1/github.
 *
 *  - GET /repo-ids fetched the repo with an "all repositories" INSTALLATION
 *    token, so any logged-in user learned whether a private org/name exists
 *    and its ids. Ids are now only returned for repos the CALLER can see;
 *    anything else answers exactly like a nonexistent repo.
 *  - Webhook: a signature of the wrong length made crypto.timingSafeEqual
 *    throw (500 + Sentry noise). It is a plain 401 now, like any bad signature.
 */

const WEBHOOK_SECRET = vi.hoisted(() => "test-webhook-secret-12345");

const mocks = vi.hoisted(() => ({
  vcsAppInstallationsFindFirst: vi.fn(),
  getInstallationToken: vi.fn(),
}));

vi.mock("../../src/config", () => ({
  config: {
    github: { apiBaseUrl: "https://api.github.com" },
    githubApp: {
      appId: "123456",
      webhookSecret: WEBHOOK_SECRET,
      name: "keyway-test",
      installUrl: "https://github.com/apps/keyway-test/installations/new",
    },
  },
}));

vi.mock("../../src/services", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../src/services");
  return { ...actual, getInstallationToken: mocks.getInstallationToken };
});

vi.mock("../../src/db", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      vcsAppInstallations: { findFirst: mocks.vcsAppInstallationsFindFirst },
    },
    update: vi.fn(),
  },
  users: { id: "id" },
  vaults: { forgeRepoId: "forgeRepoId", forgeType: "forgeType" },
  vcsAppInstallations: {
    accountLogin: "accountLogin",
    repositorySelection: "repositorySelection",
    status: "status",
  },
  vcsAppInstallationRepos: { repoId: "repoId" },
}));

vi.mock("../../src/middleware/auth", () => ({
  authenticateGitHub: vi.fn().mockImplementation(async (request) => {
    request.accessToken = "caller-user-token";
    request.vcsUser = {
      forgeType: "github",
      forgeUserId: "777",
      username: "mallory",
      email: null,
      avatarUrl: null,
    };
    request.githubUser = request.vcsUser;
  }),
  requireApiKeyScope: vi.fn(() => async () => {}),
}));

import { githubRoutes } from "../../src/api/v1/routes/github.routes";

/**
 * GitHub stub: the installation token (all repositories) sees the private repo,
 * the caller's own token does not (not a collaborator) → 404, like GitHub.
 */
function stubGitHub(callerCanSeeRepo: boolean) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const exists = !url.endsWith("/does-not-exist");
    const visible =
      exists &&
      (auth === "Bearer install-token" || (auth === "Bearer caller-user-token" && callerCanSeeRepo));
    return visible
      ? new Response(JSON.stringify({ id: 4242, owner: { id: 99 } }), { status: 200 })
      : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.vcsAppInstallationsFindFirst.mockResolvedValue({
    installationId: 1,
    accountLogin: "acme-corp",
    repositorySelection: "all",
    status: "active",
  });
  mocks.getInstallationToken.mockResolvedValue("install-token");

  app = Fastify({ logger: false });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body.toString()));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  await app.register(githubRoutes, { prefix: "/v1/github" });
  await app.ready();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

describe("GET /v1/github/repo-ids", () => {
  it("does not reveal a private repo the caller cannot access", async () => {
    const fetchMock = stubGitHub(false);

    const res = await app.inject({
      method: "GET",
      url: "/v1/github/repo-ids?repo=acme-corp/secret-project",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual({ ownerId: null, repoId: null });
    // The installation token must never be used to answer this question.
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).not.toBe("Bearer install-token");
    }
  });

  it("answers an inaccessible repo exactly like a nonexistent one", async () => {
    stubGitHub(false);
    const hidden = await app.inject({ method: "GET", url: "/v1/github/repo-ids?repo=acme-corp/secret-project" });
    const missing = await app.inject({ method: "GET", url: "/v1/github/repo-ids?repo=acme-corp/does-not-exist" });

    expect(hidden.statusCode).toBe(missing.statusCode);
    expect(JSON.parse(hidden.body).data).toEqual(JSON.parse(missing.body).data);
  });

  it("returns the ids of a repo the caller can access", async () => {
    const fetchMock = stubGitHub(true);

    const res = await app.inject({
      method: "GET",
      url: "/v1/github/repo-ids?repo=acme-corp/secret-project",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual({ ownerId: 99, repoId: 4242 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme-corp/secret-project",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer caller-user-token" }),
      })
    );
  });

  it.each(["acme-corp/a/b", "../acme-corp", "acme-corp/..", "acme-corp/.", "acme-corp/x%3Fy=1", "acme-corp/x#y"])(
    "rejects a malformed repo %s without calling GitHub",
    async (repo) => {
      const fetchMock = stubGitHub(true);

      const res = await app.inject({
        method: "GET",
        url: `/v1/github/repo-ids?repo=${encodeURIComponent(repo)}`,
      });

      expect(res.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});

describe("POST /v1/github/webhook signature check", () => {
  const payload = JSON.stringify({ action: "noop", installation: { id: 1 } });

  function post(signature: string) {
    return app.inject({
      method: "POST",
      url: "/v1/github/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "ping",
        "x-github-delivery": "d-1",
      },
      payload,
    });
  }

  it.each(["sha256=deadbeef", "garbage", `sha256=${"0".repeat(65)}`])(
    "returns 401 (not 500) for a signature of the wrong length: %s",
    async (signature) => {
      const res = await post(signature);
      expect(res.statusCode).toBe(401);
    }
  );

  it("returns 401 for a well-formed but wrong signature", async () => {
    const wrong = `sha256=${crypto.createHmac("sha256", "wrong-secret").update(payload).digest("hex")}`;
    const res = await post(wrong);
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid signature", async () => {
    const valid = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
    const res = await post(valid);
    expect(res.statusCode).toBe(200);
  });
});
