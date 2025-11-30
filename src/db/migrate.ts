import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import { validateMigrations } from './validateMigrations';

dotenv.config();

const runMigrations = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }

  // Validate that all SQL files have journal entries
  console.log('Validating migrations...');
  const validation = await validateMigrations();

  if (validation.missingFromJournal.length > 0) {
    console.error('❌ ERROR: Found SQL files not registered in _journal.json:');
    validation.missingFromJournal.forEach(f => console.error(`   - ${f}.sql`));
    console.error('\nThese migrations will NOT be applied by drizzle!');
    console.error('Add entries to drizzle/meta/_journal.json or regenerate migrations.');
    process.exit(1);
  }

  if (validation.orphanedInJournal.length > 0) {
    console.warn('⚠️  Warning: Journal entries without SQL files:');
    validation.orphanedInJournal.forEach(f => console.warn(`   - ${f}`));
  }

  const connection = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(connection);

  // Count before
  const before = await connection`
    SELECT COUNT(*)::int as count FROM drizzle.__drizzle_migrations
  `.catch(() => [{ count: 0 }]) as { count: number }[];
  const countBefore = before[0]?.count || 0;

  console.log(`Running migrations... (${countBefore} already applied)`);

  await migrate(db, { migrationsFolder: './drizzle' });

  // Count after
  const after = await connection`
    SELECT COUNT(*)::int as count FROM drizzle.__drizzle_migrations
  ` as { count: number }[];
  const countAfter = after[0]?.count || 0;
  const applied = countAfter - countBefore;

  if (applied > 0) {
    console.log(`✅ Applied ${applied} new migration(s) (total: ${countAfter})`);
  } else {
    console.log(`✅ Database is up to date (${countAfter} migrations)`);
  }

  await connection.end();
  process.exit(0);
};

runMigrations().catch((err) => {
  console.error('Migration failed!');
  console.error(err);
  process.exit(1);
});
