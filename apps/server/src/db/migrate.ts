// A deliberately small migrator. It exists because the first migration has to
// run against databases v1 already created, and drizzle-kit's generated baseline
// would fail on them. Rules for every migration:
//
//   1. Additive only (new tables, new nullable columns, new indexes). v1 must
//      still boot on a database v2 has migrated, so a rollback stays possible.
//   2. Idempotent on its own (IF NOT EXISTS, guarded ALTER), because a baseline
//      has to apply cleanly to a database that predates the bookkeeping table.
//   3. Never rewrites existing rows.
import type Database from 'better-sqlite3';
import { baseline } from './migrations/0000-baseline.js';
import { handoffs } from './migrations/0001-handoffs.js';

export interface Migration {
  /** Unique and stable, sorted by name. Convention: 0001-short-slug. */
  name: string;
  up(db: Database.Database): void;
}

/** Append new migrations here, in order. Never edit or reorder an applied one. */
export const MIGRATIONS: readonly Migration[] = [baseline, handoffs];

export const MIGRATIONS_TABLE = '_officepm_migrations';

/**
 * Applies every migration not yet recorded, each in its own immediate
 * transaction together with its bookkeeping row. Safe to call on every boot and
 * from two processes at once. Returns the names applied by this call.
 */
export function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): string[] {
  const names = migrations.map((m) => m.name);
  if (new Set(names).size !== names.length) throw new Error('duplicate migration name');
  if (names.join('\n') !== [...names].sort().join('\n')) {
    throw new Error('migrations must be listed in name order');
  }

  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );

  const isApplied = db.prepare(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name = ?`);
  const record = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`);
  const applied: string[] = [];

  for (const migration of migrations) {
    const apply = db.transaction(() => {
      // Re-check inside the write lock: another process may have just applied it.
      if (isApplied.get(migration.name)) return;
      migration.up(db);
      record.run(migration.name);
      applied.push(migration.name);
    });
    apply.immediate();
  }
  return applied;
}
