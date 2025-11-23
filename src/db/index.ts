import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const connectionString = process.env.DATABASE_URL;

// Create postgres connection
export const sql = postgres(connectionString);

// Create drizzle instance
export const db = drizzle(sql, { schema });

export * from './schema';
