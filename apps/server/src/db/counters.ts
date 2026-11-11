import type Database from 'better-sqlite3';

/**
 * Allocates the next ticket key for a board prefix, exactly as v1 does: a row in
 * `counters`, not MAX(n)+1, so deleting the newest ticket never frees its key for
 * reuse (comments, links and GitHub events may still point at it).
 */
export function allocateTicketKey(db: Database.Database, prefix: string): string {
  const allocate = db.transaction((p: string) => {
    const row = db.prepare('SELECT next FROM counters WHERE prefix = ?').get(p) as
      { next: number } | undefined;
    const n = row ? row.next : 1;
    db.prepare(
      'INSERT INTO counters (prefix, next) VALUES (?, ?) ON CONFLICT(prefix) DO UPDATE SET next = ?',
    ).run(p, n + 1, n + 1);
    return p + '-' + n;
  });
  return allocate.immediate(prefix);
}
