import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { BASELINE_SQL } from './migrations/0000-baseline.js';
import * as schema from './schema.js';

const require = createRequire(import.meta.url);
const frozenV1Dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/data-compat/frozen-v1',
);
const legacySchema = require(path.join(frozenV1Dir, 'schema.js')) as { SCHEMA_SQL: string };
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Info {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

describe('baseline migration', () => {
  it('is frozen-v1/schema.js SCHEMA_SQL, word for word', () => {
    expect(squash(BASELINE_SQL)).toBe(squash(legacySchema.SCHEMA_SQL));
  });
});

describe('drizzle schema.ts versus the migrated database', () => {
  const tables = Object.values(schema);

  it('covers every table in the database', () => {
    const real = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    const declared = tables.map((t) => getTableConfig(t).name);
    expect(new Set(declared)).toEqual(new Set(real));
  });

  for (const table of tables) {
    const cfg = getTableConfig(table);
    it(`${cfg.name}: columns, nullability, defaults and primary key match`, () => {
      const info = db.prepare(`PRAGMA table_info(${cfg.name})`).all() as Info[];
      expect(cfg.columns.map((c) => c.name)).toEqual(info.map((c) => c.name));
      for (const col of cfg.columns) {
        const real = info.find((c) => c.name === col.name)!;
        const sqlType = col.getSQLType().toUpperCase();
        expect(sqlType, `${cfg.name}.${col.name} type`).toBe(real.type);
        const isPk = real.pk > 0;
        if (isPk) continue; // drizzle models INTEGER PRIMARY KEY as having an implicit default
        expect(col.notNull, `${cfg.name}.${col.name} notnull`).toBe(real.notnull === 1);
        expect(col.hasDefault, `${cfg.name}.${col.name} has default`).toBe(
          real.dflt_value !== null,
        );
      }
      const pkCols = info
        .filter((c) => c.pk > 0)
        .map((c) => c.name)
        .sort();
      const declaredPk = [
        ...cfg.columns.filter((c) => c.primary).map((c) => c.name),
        ...cfg.primaryKeys.flatMap((p) => p.columns.map((c) => c.name)),
      ].sort();
      expect(declaredPk).toEqual(pkCols);
    });

    it(`${cfg.name}: explicit indexes match`, () => {
      const real = (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%'",
          )
          .all(cfg.name) as Array<{ name: string }>
      ).map((r) => r.name);
      expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual(real.sort());
    });
  }
});
