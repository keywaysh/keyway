import { randomUUID } from "crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { users, vaults } from "../../src/db/schema";
import type * as schema from "../../src/db/schema";
import { eq } from "drizzle-orm";
import type postgres from "postgres";

type Db = PostgresJsDatabase<typeof schema>;

export const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ||
  "postgresql://localhost:5432/keyway_test";

// ============================================================================
// Factories
// ============================================================================

export async function createUser(
  db: Db,
  overrides: Partial<typeof users.$inferInsert> = {}
) {
  const uid = randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      forgeType: "github",
      forgeUserId: `test-forge-id-${uid}`,
      username: `testuser-${uid}`,
      email: `test-${uid}@example.com`,
      encryptedAccessToken: "encrypted",
      accessTokenIv: "iv",
      accessTokenAuthTag: "tag",
      ...overrides,
    })
    .returning();
  return user;
}

export async function createVault(
  db: Db,
  ownerId: string,
  overrides: Partial<typeof vaults.$inferInsert> = {}
) {
  const [vault] = await db
    .insert(vaults)
    .values({
      forgeType: "github",
      repoFullName: `owner/repo-${randomUUID().slice(0, 8)}`,
      ownerId,
      isPrivate: false,
      ...overrides,
    })
    .returning();
  return vault;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Truncate test tables between tests for isolation.
 * Faster than transaction rollback for Drizzle since we need
 * the real module-level `db` instance (not a transaction proxy).
 */
export async function cleanTables(sql: ReturnType<typeof postgres>) {
  await sql`TRUNCATE TABLE vaults, users CASCADE`;
}

// ============================================================================
// Assertions helpers
// ============================================================================

export async function findVaultById(db: Db, id: string) {
  return db.query.vaults.findFirst({
    where: eq(vaults.id, id),
  });
}
