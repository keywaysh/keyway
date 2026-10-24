import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Fastify from "fastify";
import postgres from "postgres";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { createUser, createVault, cleanTables, TEST_DB_URL } from "./helpers";

// Test controls shared with the mocks below.
const control = vi.hoisted(() => ({
  // AES-256-GCM key per encryption version, like the crypto service.
  keys: {} as Record<number, Buffer>,
  // Runs before each encrypt call (simulates a concurrent edit between planning and writing).
  beforeEncrypt: undefined as undefined | ((plaintext: string) => Promise<void>),
  // Encrypting this value fails.
  failOn: undefined as undefined | string,
  // Runs inside the push transaction, after the locks are taken.
  insideTransaction: undefined as undefined | (() => Promise<void>),
  // Decrypt calls throw this instead of decrypting.
  decryptError: undefined as undefined | Error,
  // Encrypt calls throw this instead of encrypting.
  encryptError: undefined as undefined | Error,
}));

vi.mock("../../src/utils/encryption", async () => {
  const { createCipheriv, createDecipheriv, randomBytes: random } = await import("crypto");
  return {
    getEncryptionService: vi.fn().mockResolvedValue({
      encrypt: async (plaintext: string) => {
        await control.beforeEncrypt?.(plaintext);
        if (control.encryptError) {
          throw control.encryptError;
        }
        if (plaintext === control.failOn) {
          throw new Error("crypto service failure");
        }
        const iv = random(12);
        const cipher = createCipheriv("aes-256-gcm", control.keys[1], iv);
        const content = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        return {
          encryptedContent: content.toString("hex"),
          iv: iv.toString("hex"),
          authTag: cipher.getAuthTag().toString("hex"),
          version: 1,
        };
      },
      decrypt: async (data: {
        encryptedContent: string;
        iv: string;
        authTag: string;
        version: number;
      }) => {
        if (control.decryptError) {
          throw control.decryptError;
        }
        const decipher = createDecipheriv(
          "aes-256-gcm",
          control.keys[data.version],
          Buffer.from(data.iv, "hex")
        );
        decipher.setAuthTag(Buffer.from(data.authTag, "hex"));
        return Buffer.concat([
          decipher.update(Buffer.from(data.encryptedContent, "hex")),
          decipher.final(),
        ]).toString("utf8");
      },
    }),
  };
});
vi.mock("../../src/services/secretVersion.service", async (original) => {
  const actual = await original<typeof import("../../src/services/secretVersion.service")>();
  return {
    ...actual,
    saveSecretVersions: async (...args: Parameters<typeof actual.saveSecretVersions>) => {
      await control.insideTransaction?.();
      return actual.saveSecretVersions(...args);
    },
  };
});
// The pull route records access in the background, past the end of a test; these tests do not
// cover it, and its writes would race the next test's cleanup.
vi.mock("../../src/services/security.service", async (original) => ({
  ...(await original<object>()),
  processPullEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/services", async (original) => ({
  ...(await original<object>()),
  recordSecretAccesses: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/utils/sharedLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Authentication and GitHub are out of scope: the signed-in user is the vault admin.
const session: { userId?: string; username?: string; forgeUserId?: string } = {};
vi.mock("../../src/utils/jwt", async (original) => ({
  ...(await original<object>()),
  verifyKeywayToken: vi.fn(() => ({ ...session, forgeType: "github", githubId: 1 })),
}));
vi.mock("../../src/utils/tokenEncryption", async (original) => ({
  ...(await original<object>()),
  decryptAccessToken: vi.fn().mockResolvedValue("gho_test"),
}));
vi.mock("../../src/utils/github", async (original) => ({
  ...(await original<object>()),
  getUserRoleWithApp: vi.fn().mockResolvedValue("admin"),
  getUserRole: vi.fn().mockResolvedValue("admin"),
  hasRepoAccess: vi.fn().mockResolvedValue(true),
  getRepoInfoWithApp: vi.fn().mockResolvedValue({ isPrivate: false, id: 1 }),
}));

import { db } from "../../src/db";
import {
  apiKeys,
  permissionOverrides,
  secrets,
  secretVersions,
  vaultEnvironments,
} from "../../src/db/schema";
import { DEFAULT_ENVIRONMENTS } from "../../src/types";
import { inferEnvironmentType } from "../../src/utils/permissions";
import { ApiError } from "../../src/lib";
import { secretsRoutes } from "../../src/api/v1/routes/secrets.routes";
import { vaultsRoutes } from "../../src/api/v1/routes/vaults.routes";
import { getEncryptionService } from "../../src/utils/encryption";
import { CryptoServiceError } from "../../src/utils/remoteEncryption";
import { getUserRoleWithApp } from "../../src/utils/github";
import { parseLegacyEnv, toEnvFormat } from "../../src/utils/legacyEnvFormat";

const cleanupSql = postgres(TEST_DB_URL, { max: 1 });

const MULTI = "first line\nsecond line\nZm9vYmFy==\nlast line";
const QUOTED = 'say "hi"';
const RELEASED_CLI = "keyway-cli/dev";

// A promise the test resolves to let a paused push continue.
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let reached!: () => void;
  const isReached = new Promise<void>((resolve) => (reached = resolve));
  return { open, opened, reached, isReached };
}

// Settles within `ms`, else "pending".
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);

type Env = Awaited<ReturnType<typeof setup>>;

async function setup(stored: Record<string, string>, trashed: Record<string, string> = {}) {
  const user = await createUser(db);
  const vault = await createVault(db, user.id);
  // Like POST /v1/vaults
  await db.insert(vaultEnvironments).values(
    DEFAULT_ENVIRONMENTS.map((name, index) => ({
      vaultId: vault.id,
      name,
      type: inferEnvironmentType(name),
      displayOrder: index,
    }))
  );
  Object.assign(session, {
    userId: user.id,
    username: user.username,
    forgeUserId: user.forgeUserId,
  });
  const encryption = await getEncryptionService();
  for (const [entries, deletedAt] of [
    [stored, null],
    [trashed, new Date()],
  ] as const) {
    for (const [key, value] of Object.entries(entries)) {
      const encrypted = await encryption.encrypt(value);
      await db.insert(secrets).values({
        vaultId: vault.id,
        environment: "development",
        key,
        encryptedValue: encrypted.encryptedContent,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encryptionVersion: encrypted.version ?? 1,
        deletedAt,
      });
    }
  }
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send(error.toProblemDetails(request.id));
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ detail: error.message });
    }
    return reply.status(500).send({ detail: error.message });
  });
  await app.register(secretsRoutes, { prefix: "/v1/secrets" });
  await app.register(vaultsRoutes, { prefix: "/v1/vaults" });
  await app.ready();

  const push = async (
    payload: Record<string, string>,
    {
      userAgent,
      mode,
      token = "Bearer test",
      query = "",
      repoFullName = vault.repoFullName,
      environment = "development",
    }: {
      userAgent?: string;
      mode?: string;
      token?: string;
      query?: string;
      repoFullName?: string;
      // null leaves it out of the body
      environment?: string | null;
    } = {}
  ) => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/secrets/push${query}`,
      headers: { authorization: token, ...(userAgent ? { "user-agent": userAgent } : {}) },
      payload: {
        repoFullName,
        ...(environment === null ? {} : { environment }),
        secrets: payload,
        ...(mode ? { mode } : {}),
      },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const pullResponse = (environment: string) =>
    app.inject({
      method: "GET",
      url: `/v1/secrets/pull?repo=${encodeURIComponent(vault.repoFullName)}&environment=${environment}`,
      headers: { authorization: "Bearer test" },
    });
  const pull = async (environment: string) => (await pullResponse(environment)).statusCode;
  const renameEnvironment = async (name: string, newName: string) => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/vaults/${vault.repoFullName}/environments/${name}`,
      headers: { authorization: "Bearer test" },
      payload: { newName },
    });
    return res.statusCode;
  };
  const listVersions = async (secretId: string) => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vaults/${vault.repoFullName}/secrets/${secretId}/versions`,
      headers: { authorization: "Bearer test" },
    });
    return res.statusCode;
  };
  const deleteEnvironment = async (name: string) => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/vaults/${vault.repoFullName}/environments/${name}`,
      headers: { authorization: "Bearer test" },
    });
    return res.statusCode;
  };
  const decrypt = (row: {
    encryptedValue: string;
    iv: string;
    authTag: string;
    encryptionVersion: number;
  }) =>
    encryption.decrypt({
      encryptedContent: row.encryptedValue,
      iv: row.iv,
      authTag: row.authTag,
      version: row.encryptionVersion,
    });
  // Every row of the environment, decrypted, including trashed ones.
  const rows = async () => {
    const all = await db.query.secrets.findMany({ where: eq(secrets.vaultId, vault.id) });
    return Promise.all(
      all.map(async (row) => ({
        id: row.id,
        key: row.key,
        environment: row.environment,
        value: await decrypt(row).catch(() => "<undecryptable>"),
        trashed: row.deletedAt !== null,
        lastModifiedById: row.lastModifiedById,
      }))
    );
  };
  const active = async () =>
    Object.fromEntries(
      (await rows()).filter((row) => !row.trashed).map((row) => [row.key, row.value])
    );
  const versions = async () => {
    const all = await db.select().from(secretVersions).where(eq(secretVersions.vaultId, vault.id));
    return Promise.all(
      all.map((version) => decrypt(version).catch(() => `<raw:${version.encryptedValue}>`))
    );
  };
  // Simulates another writer (e.g. the dashboard) changing a stored value directly.
  const overwrite = async (key: string, value: string) => {
    const encrypted = await encryption.encrypt(value);
    await db
      .update(secrets)
      .set({
        encryptedValue: encrypted.encryptedContent,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      })
      .where(eq(secrets.key, key));
  };
  // Simulates another writer (e.g. the dashboard) creating a secret directly.
  const create = async (key: string, value: string) => {
    const encrypted = await encryption.encrypt(value);
    await db.insert(secrets).values({
      vaultId: vault.id,
      environment: "development",
      key,
      encryptedValue: encrypted.encryptedContent,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      encryptionVersion: encrypted.version ?? 1,
    });
  };
  return {
    user,
    vault,
    push,
    create,
    pull,
    pullResponse,
    renameEnvironment,
    deleteEnvironment,
    listVersions,
    rows,
    active,
    versions,
    overwrite,
  };
}

beforeEach(async () => {
  await cleanTables(cleanupSql);
  control.keys = { 1: randomBytes(32), 2: randomBytes(32) };
  control.beforeEncrypt = undefined;
  control.failOn = undefined;
  control.insideTransaction = undefined;
  control.decryptError = undefined;
  control.encryptError = undefined;
  vi.mocked(getUserRoleWithApp).mockResolvedValue("admin");
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("POST /v1/secrets/push (real handler, real DB)", () => {
  it("archives the previous value before an update", async () => {
    const { user, push, rows, active, versions } = await setup({ A: "1", B: "b" });
    const { status, body } = await push({ A: "2", B: "b" });
    expect(status).toBe(200);
    expect(body.data.stats).toMatchObject({ created: 0, updated: 1, deleted: 0, unchanged: 1 });
    expect(await active()).toEqual({ A: "2", B: "b" });
    expect(await versions()).toEqual(["1"]);
    expect((await rows()).find((row) => row.key === "A")!.lastModifiedById).toBe(user.id);
    const [a] = await db.select().from(secrets).where(eq(secrets.key, "A"));
    expect(Math.abs(a.updatedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("writes nothing for unchanged values", async () => {
    const { push, rows, versions } = await setup({ A: "1" });
    const before = await rows();
    const { body } = await push({ A: "1" });
    expect(body.data.stats).toMatchObject({ unchanged: 1, updated: 0 });
    expect(await rows()).toEqual(before);
    expect(await versions()).toEqual([]);
  });

  it("keeps the stored values a released CLI sends back corrupted (keyway set)", async () => {
    const stored = { MULTI, QUOTED, PLAIN: "ok" };
    const { push, active, versions } = await setup(stored);
    const sent = { ...parseLegacyEnv(toEnvFormat(stored), "go"), NEW_KEY: "v" };
    const { status, body } = await push(sent, { userAgent: RELEASED_CLI });
    expect(status).toBe(200);
    expect(await active()).toEqual({ ...stored, NEW_KEY: "v" });
    expect(await versions()).toEqual([]);
    expect(body.data.stats).toMatchObject({ created: 1, updated: 0, protected: 2, ignored: 1 });
    expect(body.data.message).toContain("Kept the stored values of MULTI, QUOTED");
    expect(body.data.message).toContain("Did not create 1 key found inside multi-line values");
    expect(body.data.message).not.toContain("Zm9vYmFy");
  });

  it("leaves the other secrets in place when MCP 1.0.0 sets one secret", async () => {
    const { push, active } = await setup({ A: "1", B: "2" });
    const { status, body } = await push({ NEW: "v" }, { userAgent: "keyway-mcp/1.0.0" });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ mode: "merge", stats: { created: 1, deleted: 0 } });
    expect(await active()).toEqual({ A: "1", B: "2", NEW: "v" });
  });

  it("refuses a value a released CLI truncated, and writes nothing", async () => {
    const { push, rows, versions } = await setup({ A: "1" });
    const before = await rows();
    const { status, body } = await push(
      { A: "2", NEW: '"first line' },
      { userAgent: RELEASED_CLI }
    );
    expect(status).toBe(400);
    expect(body.detail).toContain("NEW (multi-line value)");
    expect(body.detail).toContain("nothing was saved");
    expect(await rows()).toEqual(before);
    expect(await versions()).toEqual([]);
  });

  it("still trashes the keys a released CLI leaves out (push --prune)", async () => {
    const { push, rows } = await setup({ A: "1", B: "2" });
    const { body } = await push({ A: "1" }, { userAgent: RELEASED_CLI });
    expect(body.data).toMatchObject({ mode: "replace", stats: { deleted: 1 } });
    expect((await rows()).find((row) => row.key === "B")!.trashed).toBe(true);
  });

  it("honors an explicit merge mode and reports it", async () => {
    const { push, active } = await setup({ A: "1", B: "2" });
    const { status, body } = await push(
      { A: "1" },
      { userAgent: "keyway-cli/0.6.1", mode: "merge" }
    );
    expect(status).toBe(200);
    expect(body.data.mode).toBe("merge");
    expect(await active()).toEqual({ A: "1", B: "2" });
  });

  it("rejects an unknown mode", async () => {
    const { push, rows } = await setup({ A: "1" });
    const before = await rows();
    const { status } = await push({ A: "2" }, { mode: "upsert" });
    expect(status).toBe(400);
    expect(await rows()).toEqual(before);
  });

  it("creates a fresh secret for a key that is in the trash, and leaves the trashed one", async () => {
    const { push, rows } = await setup({ A: "1" }, { B: "old" });
    const { body } = await push({ A: "1", B: "old" });
    expect(body.data.stats).toMatchObject({ created: 1, unchanged: 1 });
    const b = (await rows()).filter((row) => row.key === "B");
    expect(b.map((row) => [row.value, row.trashed]).sort()).toEqual([
      ["old", false],
      ["old", true],
    ]);
  });

  it("writes nothing when encrypting a value fails", async () => {
    const { push, rows, versions } = await setup({ A: "1", B: "2" });
    const before = await rows();
    control.failOn = "boom";
    const { status } = await push({ A: "changed", B: "boom", C: "new" });
    expect(status).toBe(500);
    expect(await rows()).toEqual(before);
    expect(await versions()).toEqual([]);
  });

  it("does not let a value it cannot decrypt block pushes, and archives it when overwritten", async () => {
    const { push, rows, active, versions } = await setup({ A: "1" });
    control.keys[1] = randomBytes(32); // A was encrypted with a key the service no longer has
    const { status } = await push({ A: "2", B: "b" });
    expect(status).toBe(200);
    expect(await active()).toEqual({ A: "2", B: "b" });
    const archived = await versions();
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/^<raw:/);
    expect((await rows()).filter((row) => row.key === "A")).toHaveLength(1);
  });

  it("re-plans when the environment changes between planning and writing", async () => {
    const { push, active, versions, overwrite } = await setup({ A: "1" });
    let edited = false;
    control.beforeEncrypt = async (plaintext) => {
      if (plaintext === "2" && !edited) {
        edited = true;
        await overwrite("A", "dashboard");
      }
    };
    const { status } = await push({ A: "2" });
    expect(status).toBe(200);
    expect(await active()).toEqual({ A: "2" });
    // The value actually overwritten is the one archived.
    expect(await versions()).toEqual(["dashboard"]);
  });

  it("gives up with 409 when the environment keeps changing", async () => {
    const { push, active, overwrite } = await setup({ A: "1" });
    let n = 0;
    control.beforeEncrypt = async (plaintext) => {
      if (plaintext === "2") {
        await overwrite("A", `dashboard-${++n}`);
      }
    };
    const { status, body } = await push({ A: "2" });
    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.detail).toMatch(/changed/i);
    expect((await active()).A).toMatch(/^dashboard-/);
  });

  it("does not block pulls of the vault while a push holds its locks", async () => {
    const { push, pull } = await setup({ A: "1" });
    const paused = gate();
    control.insideTransaction = async () => {
      paused.reached();
      await paused.opened;
    };
    const pushing = push({ A: "2" });
    try {
      await paused.isReached;
      // The pull writes an activity log row, whose foreign key check needs the vault row.
      expect(await within(pull("development"), 3000)).toBe(200);
    } finally {
      paused.open();
    }
    expect((await pushing).status).toBe(200);
  });

  it("runs pushes to a vault one at a time", async () => {
    const { push, active, versions } = await setup({ A: "1" });
    const paused = gate();
    let first = true;
    control.insideTransaction = async () => {
      if (first) {
        first = false;
        paused.reached();
        await paused.opened;
      }
    };
    const pushing = push({ A: "2", NEW: "v" });
    const second = (async () => {
      await paused.isReached;
      return push({ A: "3", NEW: "v" });
    })();
    try {
      await paused.isReached;
      expect(await within(second, 500)).toBe("pending");
    } finally {
      paused.open();
    }
    expect((await pushing).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(await active()).toEqual({ A: "3", NEW: "v" });
    expect((await versions()).sort()).toEqual(["1", "2"]);
  });

  it("makes an environment rename wait for a running push, then both apply", async () => {
    const { push, renameEnvironment, rows } = await setup({ A: "1" });
    const paused = gate();
    control.insideTransaction = async () => {
      paused.reached();
      await paused.opened;
    };
    const pushing = push({ A: "2", NEW: "v" });
    const renaming = (async () => {
      await paused.isReached;
      return renameEnvironment("development", "dev2");
    })();
    try {
      await paused.isReached;
      expect(await within(renaming, 500)).toBe("pending");
    } finally {
      paused.open();
    }
    expect((await pushing).status).toBe(200);
    expect(await renaming).toBe(200);
    const active = (await rows()).filter((row) => !row.trashed);
    expect(active.map((row) => [row.environment, row.key, row.value]).sort()).toEqual([
      ["dev2", "A", "2"],
      ["dev2", "NEW", "v"],
    ]);
  });

  it("answers 409 instead of waiting forever when the vault stays locked", async () => {
    const { vault, push, rows } = await setup({ A: "1" });
    const before = await rows();
    // Another session holds the vault row longer than the push's lock_timeout (5 s).
    const other = postgres(TEST_DB_URL, { max: 1 });
    const holder = other.begin(async (session) => {
      await session`SELECT id FROM vaults WHERE id = ${vault.id} FOR UPDATE`;
      await new Promise((resolve) => setTimeout(resolve, 7000));
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { status, body } = await push({ A: "2" });
      expect(status, JSON.stringify(body)).toBe(409);
      expect(await rows()).toEqual(before);
    } finally {
      await holder;
      await other.end();
    }
  }, 20000);

  it("gives a caller that can write but not read no guard and no equality signal", async () => {
    const stored = { MULTI, PLAIN: "ok" };
    const { user, push, active, versions } = await setup(stored);
    const key = `kw_live_${randomBytes(20).toString("hex")}`;
    await db.insert(apiKeys).values({
      userId: user.id,
      name: "write only",
      keyPrefix: key.slice(0, 16),
      keyHash: createHash("sha256").update(key).digest("hex"),
      environment: "live",
      scopes: ["write:secrets"],
    });
    const sent = { ...parseLegacyEnv(toEnvFormat(stored), "go"), GUESS: '"x' };
    const { status, body } = await push(sent, { userAgent: RELEASED_CLI, token: `Bearer ${key}` });
    expect(status).toBe(200);
    expect(body.data.stats).toMatchObject({ unchanged: 0, protected: 0, ignored: 0, updated: 2 });
    expect((await active()).MULTI).toBe('"first line');
    // PLAIN is rewritten like any other value, but its unchanged value is not archived again.
    expect(await versions()).toEqual([MULTI]);
  });
  it.each([
    ["renamed", (env: Env) => env.renameEnvironment("development", "dev2"), [["dev2", "A", "1"]]],
    ["deleted", (env: Env) => env.deleteEnvironment("development"), []],
  ] as const)(
    "writes nothing when the environment is %s before the push writes",
    async (_, change, expected) => {
      const env = await setup({ A: "1" });
      let changed = false;
      control.beforeEncrypt = async (plaintext) => {
        if (plaintext === "2" && !changed) {
          changed = true;
          expect(await change(env)).toBe(200);
        }
      };
      const { status, body } = await env.push({ A: "2", NEW: "v" });
      expect(status, JSON.stringify(body)).toBe(400);
      expect(body.detail).toContain("does not exist");
      const active = (await env.rows()).filter((row) => !row.trashed);
      expect(active.map((row) => [row.environment, row.key, row.value])).toEqual(expected);
      expect(await env.versions()).toEqual([]);
    }
  );

  it("writes nothing while the crypto service is unavailable, even for a released client", async () => {
    // Without the stored value, the released CLI's copy of A ("v2") would look like a change.
    const stored = { A: "'v2'", B: "b" };
    const { push, rows, versions } = await setup(stored);
    const before = await rows();
    control.decryptError = new CryptoServiceError(
      "unavailable",
      "decrypt",
      "test",
      undefined,
      true
    );
    const sent = { ...parseLegacyEnv(toEnvFormat(stored), "go"), OTHER: "v" };
    const { status } = await push(sent, { userAgent: RELEASED_CLI });
    expect(status).toBe(503);
    control.decryptError = undefined;
    expect(await rows()).toEqual(before);
    expect(await versions()).toEqual([]);
  });

  it("does not archive a value a write-only caller pushes unchanged", async () => {
    const { user, push, active, versions } = await setup({ A: "1", B: "b" });
    const key = `kw_live_${randomBytes(20).toString("hex")}`;
    await db.insert(apiKeys).values({
      userId: user.id,
      name: "write only",
      keyPrefix: key.slice(0, 16),
      keyHash: createHash("sha256").update(key).digest("hex"),
      environment: "live",
      scopes: ["write:secrets"],
    });
    for (let i = 0; i < 3; i++) {
      expect((await push({ A: "1", B: "b" }, { token: `Bearer ${key}` })).status).toBe(200);
    }
    expect((await push({ A: "2", B: "b" }, { token: `Bearer ${key}` })).status).toBe(200);
    expect(await active()).toEqual({ A: "2", B: "b" });
    expect(await versions()).toEqual(["1"]);
  });

  it("lets MCP 1.0.0 set one secret to what a released parser would read from it", async () => {
    const { push, active } = await setup({ A: "'v1'", B: "2" });
    const { status, body } = await push({ A: "v1" }, { userAgent: "keyway-mcp/1.0.0" });
    expect(status).toBe(200);
    expect(body.data.stats).toMatchObject({ updated: 1, protected: 0 });
    expect(await active()).toEqual({ A: "v1", B: "2" });
  });
  it("refuses a push that names another vault in its body than in its URL", async () => {
    const victim = await setup({ A: "victim" });
    const caller = await setup({});
    // The caller administers its own repository and has no access to the victim's.
    vi.mocked(getUserRoleWithApp).mockImplementation(async (repo) =>
      repo === caller.vault.repoFullName ? "admin" : null
    );
    const { status } = await caller.push(
      { A: "changed", NEW: "v" },
      {
        query: `?repo=${encodeURIComponent(caller.vault.repoFullName)}&environment=development`,
        repoFullName: victim.vault.repoFullName,
      }
    );
    expect(status).toBe(400);
    expect(await victim.active()).toEqual({ A: "victim" });
    expect(await victim.versions()).toEqual([]);
  });

  it("refuses a push that names another environment in its body than in its URL", async () => {
    const { push, rows } = await setup({ A: "1" });
    // The write role may write development but not production.
    vi.mocked(getUserRoleWithApp).mockResolvedValue("write");
    expect((await push({ P: "v" }, { environment: "production" })).status).toBe(403);
    const { status } = await push(
      { P: "v" },
      { query: "?environment=development", environment: "production" }
    );
    expect(status).toBe(400);
    expect((await rows()).filter((row) => row.environment === "production")).toEqual([]);
  });
  it("refuses a push authorized for one environment that would write another by default", async () => {
    const { vault, push, rows } = await setup({ A: "1" });
    await db
      .insert(vaultEnvironments)
      .values({ vaultId: vault.id, name: "default", type: "standard", displayOrder: 3 });
    const { status } = await push(
      { P: "v" },
      { query: "?environment=development", environment: null }
    );
    expect(status).toBe(400);
    expect((await rows()).filter((row) => row.environment === "default")).toEqual([]);
  });
  it("keeps over-long keys, which may be text from inside stored values, out of a 400", async () => {
    const { push, rows } = await setup({ A: "1" });
    const before = await rows();
    const longKey = "Zm9vYmFy".repeat(40);
    const { status, body } = await push({ A: "1", [longKey]: "x" }, { userAgent: RELEASED_CLI });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("Zm9vYmFyZm9vYmFy");
    expect(body.detail).toBe("Invalid request data");
    expect(body.errors).toEqual([
      { field: "secrets", code: "invalid", message: "Secret key must not exceed 256 characters" },
    ]);
    expect(await rows()).toEqual(before);
  });
  it("shows version history only to callers who may read the environment", async () => {
    const { user, vault, push, rows, listVersions } = await setup({ A: "1" });
    expect((await push({ A: "2" })).status).toBe(200);
    const id = (await rows()).find((row) => row.key === "A")!.id;
    expect(await listVersions(id)).toBe(200);
    // The same user, allowed to write development but not to read it.
    await db.insert(permissionOverrides).values({
      vaultId: vault.id,
      environment: "development",
      targetType: "user",
      targetUserId: user.id,
      canRead: false,
      canWrite: true,
    });
    expect(await listVersions(id)).toBe(403);
  });
  it("answers 503 when the crypto service is unavailable while encrypting", async () => {
    // Nothing stored, so nothing to decrypt: the outage shows up at encryption.
    const { push, rows } = await setup({});
    control.encryptError = new CryptoServiceError(
      "unavailable",
      "encrypt",
      "test",
      undefined,
      true
    );
    const { status } = await push({ A: "1" });
    expect(status).toBe(503);
    control.encryptError = undefined;
    expect(await rows()).toEqual([]);
  });
  it("re-plans when another writer creates a pushed key while the push holds its locks", async () => {
    const { push, create, active, versions } = await setup({ A: "1" });
    let created = false;
    control.insideTransaction = async () => {
      if (!created) {
        created = true;
        await create("NEW", "dashboard");
      }
    };
    const { status, body } = await push({ A: "1", NEW: "pushed" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(await active()).toEqual({ A: "1", NEW: "pushed" });
    expect(await versions()).toEqual(["dashboard"]);
  });
  it("runs pushes to an empty environment one at a time", async () => {
    // No row to lock: only the vault lock makes the second push wait.
    const { push, active } = await setup({});
    const paused = gate();
    let first = true;
    control.insideTransaction = async () => {
      if (first) {
        first = false;
        paused.reached();
        await paused.opened;
      }
    };
    const pushing = push({ A: "1" }, { mode: "merge" });
    const second = (async () => {
      await paused.isReached;
      return push({ B: "2" }, { mode: "merge" });
    })();
    try {
      await paused.isReached;
      expect(await within(second, 500)).toBe("pending");
    } finally {
      paused.open();
    }
    expect((await pushing).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(await active()).toEqual({ A: "1", B: "2" });
  });
  it("refuses a released client's push while a stored value cannot be decrypted", async () => {
    // Without that value, the guard cannot recognize the client's copy of it, nor the keys the
    // client read from inside it. These clients cannot pull such an environment anyway.
    const stored = { A: "'v2'", B: "b" };
    const { push, rows, versions } = await setup(stored);
    const before = await rows();
    control.decryptError = new CryptoServiceError("no key", "decrypt", "test", undefined, false);
    const sent = { ...parseLegacyEnv(toEnvFormat(stored), "go"), OTHER: "v" };
    const { status, body } = await push(sent, { userAgent: RELEASED_CLI });
    control.decryptError = undefined;
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.detail).toContain("nothing was saved");
    expect(await rows()).toEqual(before);
    expect(await versions()).toEqual([]);
  });
});

describe("POST /v1/secrets/push: keys it creates", () => {
  it.each([["K\nL"], [""], ["#COMMENTED"], [" PADDED"], ["A=B"], ["NUL\u0000"], ["LS\u2028"]])(
    "refuses to create %j, which a .env file cannot hold, and writes nothing",
    async (key) => {
      const { push, rows } = await setup({ A: "1" });
      const before = await rows();
      const { status, body } = await push({ A: "1", [key]: "value-1" }, { mode: "merge" });
      expect(status, JSON.stringify(body)).toBe(400);
      expect(body.detail).toContain("Cannot create 1 secret(s) (");
      expect(await rows()).toEqual(before);
    }
  );

  it("still updates an existing key with such a name", async () => {
    const { push, active } = await setup({ "odd key": "1" });
    const { status } = await push({ "odd key": "2" }, { mode: "merge" });
    expect(status).toBe(200);
    expect(await active()).toEqual({ "odd key": "2" });
  });
});

describe("GET /v1/secrets/pull (real handler, real DB)", () => {
  it("returns each stored value exactly next to the .env content", async () => {
    // A .env file cannot hold every value exactly (e.g. 'x', or one ending with \r), so
    // clients read secrets, not content.
    const stored = {
      MULTI,
      QUOTED,
      TRAIL: "ends with \\",
      SPACED: "  padded  ",
      ["__proto__"]: "own key",
    };
    const { pullResponse } = await setup(stored);
    const res = await pullResponse("development");
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.secrets).toEqual(stored);
    expect(Object.keys(data.secrets).sort()).toEqual(Object.keys(stored).sort());
    // Same values, in the order the rows came back
    expect(data.content).toBe(toEnvFormat(data.secrets));
  });

  it("lists secrets by key, whatever order they were stored in", async () => {
    // The same environment always reads the same way, page after page
    const { pullResponse } = await setup({ ZETA: "1", ALPHA: "2", MID: "3" });
    // With fresh statistics, Postgres reads a tiny table in storage order, not by index
    await cleanupSql`ANALYZE secrets`;
    const { data } = JSON.parse((await pullResponse("development")).body);
    expect(Object.keys(data.secrets)).toEqual(["ALPHA", "MID", "ZETA"]);
    expect(data.content).toBe("ALPHA=2\nMID=3\nZETA=1");
  });
});
