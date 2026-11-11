import { sql, type SQL } from 'drizzle-orm';
import type { Orm } from '../db/index.js';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/** COUNT(*) over a table with a where clause. */
export function countWhere(orm: Orm, table: SQLiteTable, where: SQL | undefined): number {
  const row = orm
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(where)
    .get();
  return row?.n ?? 0;
}
