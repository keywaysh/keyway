import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { createUser, createVault, cleanTables, TEST_DB_URL } from "./helpers";

// Mock ONLY the crypto gRPC client — the real crypto round-trip is covered by
// the Go tests in packages/crypto (TestGRPC_EncryptDecrypt_RoundTrip). Here we
// use a faithful reversible transform so that a corrupted DB round-trip (bad
// blob storage/retrieval) makes decrypt fail to recover the plaintext.
vi.mock("../../src/utils/encryption", () => ({
  getEncryptionService: vi.fn().mockResolvedValue({
    encrypt: async (plaintext: string) => ({
      encryptedContent: Buffer.from(plaintext, "utf8").toString("base64"),
      iv: "iv-" + Buffer.from(plaintext).length,
      authTag: "tag",
      version: 1,
    }),
    decrypt: async ({ encryptedContent }: { encryptedContent: string }) =>
      Buffer.from(encryptedContent, "base64").toString("utf8"),
  }),
}));

// Reduce log noise
vi.mock("../../src/utils/sharedLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Real db + real services (connected to test postgres)
import {
  upsertSecret,
  getSecretValue,
  getSecretsForVault,
  getSecretById,
  getSecretsCount,
  trashSecret,
  getTrashedSecrets,
  restoreSecret,
} from "../../src/services/secret.service";
import { db } from "../../src/db";

const cleanupSql = postgres(TEST_DB_URL, { max: 1 });

async function makeVault() {
  const user = await createUser(db);
  const vault = await createVault(db, user.id);
  return { user, vault };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanTables(cleanupSql);
});

afterAll(async () => {
  await cleanupSql.end();
});

describe("Secret access & decryption round-trip (real DB)", () => {
  // ==========================================================================
  // THE core guarantee: store an encrypted secret, then read it back and
  // decrypt to the ORIGINAL plaintext — through the real drizzle query layer.
  // ==========================================================================
  it("stores an encrypted secret and reveals the original plaintext", async () => {
    const { vault } = await makeVault();
    const plaintext = "s3cr3t-value-with-symbols-!@#$%^&*()_+={}[]|;:,.<>?";

    const created = await upsertSecret({
      vaultId: vault.id,
      key: "API_KEY",
      value: plaintext,
      environment: "production",
    });
    expect(created.status).toBe("created");

    const revealed = await getSecretValue(created.id, vault.id);
    expect(revealed).not.toBeNull();
    expect(revealed!.value).toBe(plaintext); // decrypts back to the exact input
    expect(revealed!.key).toBe("API_KEY");
    expect(revealed!.environment).toBe("production");
  });

  it("upsert updates in place and reveals the NEW plaintext", async () => {
    const { vault } = await makeVault();
    const first = await upsertSecret({
      vaultId: vault.id,
      key: "TOKEN",
      value: "old-value",
      environment: "default",
    });

    const second = await upsertSecret({
      vaultId: vault.id,
      key: "TOKEN",
      value: "new-value",
      environment: "default",
    });

    expect(second.status).toBe("updated");
    expect(second.id).toBe(first.id); // same row, upsert by key+environment

    const revealed = await getSecretValue(first.id, vault.id);
    expect(revealed!.value).toBe("new-value");
  });

  it("lists active secrets and counts them correctly", async () => {
    const { vault } = await makeVault();
    await upsertSecret({ vaultId: vault.id, key: "A", value: "1", environment: "default" });
    await upsertSecret({ vaultId: vault.id, key: "B", value: "2", environment: "default" });
    await upsertSecret({ vaultId: vault.id, key: "A", value: "3", environment: "staging" });

    const list = await getSecretsForVault(vault.id);
    const keys = list.map((s) => `${s.key}:${s.environment}`).sort();
    expect(keys).toEqual(["A:default", "A:staging", "B:default"]);
    expect(await getSecretsCount(vault.id)).toBe(3);
  });

  it("does not leak secrets across vaults", async () => {
    const a = await makeVault();
    const b = await makeVault();
    const s = await upsertSecret({
      vaultId: a.vault.id,
      key: "SHARED",
      value: "only-in-a",
      environment: "default",
    });

    // Correct vault reveals it
    expect((await getSecretValue(s.id, a.vault.id))!.value).toBe("only-in-a");
    // Wrong vault must NOT (the and(eq(vaultId)) guard)
    expect(await getSecretValue(s.id, b.vault.id)).toBeNull();
    expect(await getSecretById(s.id, b.vault.id)).toBeNull();
  });

  it("trash hides a secret from active reads, restore brings it back decryptable", async () => {
    const { vault } = await makeVault();
    const s = await upsertSecret({
      vaultId: vault.id,
      key: "DB_URL",
      value: "postgres://secret",
      environment: "production",
    });

    // Trash → excluded from active queries (isNull(deletedAt) filter)
    const trashed = await trashSecret(s.id, vault.id);
    expect(trashed).not.toBeNull();
    expect(await getSecretById(s.id, vault.id)).toBeNull();
    expect(await getSecretValue(s.id, vault.id)).toBeNull();
    expect(await getSecretsCount(vault.id)).toBe(0);

    const inTrash = await getTrashedSecrets(vault.id);
    expect(inTrash.map((t) => t.key)).toEqual(["DB_URL"]);

    // Restore → active again AND still decryptable to the original value
    const restored = await restoreSecret(s.id, vault.id);
    expect(restored).not.toBeNull();
    const revealed = await getSecretValue(s.id, vault.id);
    expect(revealed!.value).toBe("postgres://secret");
  });
});
