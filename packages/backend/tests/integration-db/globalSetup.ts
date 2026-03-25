// globalSetup: runs once before all tests (in a separate process)
// Handles migrations and final cleanup

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ||
  "postgresql://localhost:5432/keyway_test";

export async function setup() {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await sql.end();
}
