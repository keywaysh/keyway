import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const connectionString = process.env.DATABASE_URL;

// Create postgres connection
export const sql = postgres(connectionString);

// Create drizzle instance
export const db = drizzle(sql, { schema });

/** The database or a transaction, for helpers that must run inside the caller's transaction. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export * from "./schema";
