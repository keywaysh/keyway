/**
 * Validates that all migration SQL files have corresponding journal entries.
 * Run this at startup or before deployments to catch missing migrations early.
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export async function validateMigrations(migrationsFolder = "./drizzle"): Promise<{
  valid: boolean;
  missingFromJournal: string[];
  orphanedInJournal: string[];
}> {
  const result = {
    valid: true,
    missingFromJournal: [] as string[],
    orphanedInJournal: [] as string[],
  };

  try {
    // Read all SQL files in the migrations folder
    const files = await readdir(migrationsFolder);
    const sqlFiles = files
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(".sql", ""))
      .sort();

    // Read the journal
    const journalPath = join(migrationsFolder, "meta", "_journal.json");
    const journalContent = await readFile(journalPath, "utf-8");
    const journal: Journal = JSON.parse(journalContent);
    const journalTags = new Set(journal.entries.map((e) => e.tag));

    // Check for SQL files not in journal
    for (const sqlFile of sqlFiles) {
      if (!journalTags.has(sqlFile)) {
        result.missingFromJournal.push(sqlFile);
        result.valid = false;
      }
    }

    // Check for journal entries without SQL files
    const sqlFileSet = new Set(sqlFiles);
    for (const entry of journal.entries) {
      if (!sqlFileSet.has(entry.tag)) {
        result.orphanedInJournal.push(entry.tag);
        result.valid = false;
      }
    }
  } catch (error) {
    // If we can't read the files, don't fail - just log
    console.warn("Could not validate migrations:", error);
  }

  return result;
}

export async function logMigrationValidation(): Promise<void> {
  const result = await validateMigrations();

  if (!result.valid) {
    console.warn("⚠️  Migration validation warnings:");

    if (result.missingFromJournal.length > 0) {
      console.warn("  SQL files not in journal (will NOT be applied by drizzle):");
      result.missingFromJournal.forEach((f) => console.warn(`    - ${f}.sql`));
    }

    if (result.orphanedInJournal.length > 0) {
      console.warn("  Journal entries without SQL files:");
      result.orphanedInJournal.forEach((f) => console.warn(`    - ${f}`));
    }
  }
}
