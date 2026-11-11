import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './migrate.js';
import * as schema from './schema.js';

export type Orm = BetterSQLite3Database<typeof schema>;

export interface OpenDatabase {
  orm: Orm;
  raw: Database.Database;
  /** Migrations applied by this open (empty when the database was already current). */
  applied: string[];
  close(): void;
}

export type OpenOptions =
  | { dataDir: string; filename?: undefined }
  /** `filename` may be ':memory:' or any path; dataDir is then not touched. */
  | { filename: string; dataDir?: undefined };

/** The v1 layout: pm.db sits directly in the data directory. */
export function dbFilePath(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'pm.db');
}

/**
 * Opens (creating if needed) the database, applies the v1 pragmas, runs
 * migrations and returns a drizzle handle plus the raw better-sqlite3 handle.
 */
export function openDatabase(options: OpenOptions): OpenDatabase {
  let file: string;
  if (options.filename !== undefined) {
    file = options.filename;
  } else {
    fs.mkdirSync(path.resolve(options.dataDir), { recursive: true });
    file = dbFilePath(options.dataDir);
  }

  const raw = new Database(file);
  try {
    raw.pragma('journal_mode = WAL'); // same as v1: mitigates corruption risk
    raw.pragma('foreign_keys = ON');
    const applied = runMigrations(raw);
    const orm = drizzle(raw, { schema });
    return { orm, raw, applied, close: () => raw.close() };
  } catch (err) {
    raw.close();
    throw err;
  }
}
