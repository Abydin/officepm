import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, MIGRATIONS_TABLE, runMigrations, type Migration } from './migrate.js';
import { BASELINE_SQL, TICKET_EXTRA_COLUMNS } from './migrations/0000-baseline.js';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
});
afterEach(() => db.close());

const cols = (table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('runMigrations', () => {
  it('applies every migration, baseline first, to an empty database and records them', () => {
    expect(runMigrations(db)).toEqual(['0000-baseline', '0001-handoffs']);
    expect(MIGRATIONS.map((m) => m.name)).toEqual(['0000-baseline', '0001-handoffs']);
    expect(cols('tickets')).toEqual(expect.arrayContaining(['priority', 'labels', 'due_date']));
    const rows = db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all();
    expect(rows).toEqual([{ name: '0000-baseline' }, { name: '0001-handoffs' }]);
  });

  it('adds the department column and the handoff tables to a v1 database without touching its rows', () => {
    db.exec(BASELINE_SQL);
    db.prepare("INSERT INTO users (email, name, password) VALUES ('a@b.c', 'A', 'hash')").run();
    runMigrations(db);
    expect(cols('users')).toContain('department');
    expect(db.prepare('SELECT email, password, department FROM users').all()).toEqual([
      { email: 'a@b.c', password: 'hash', department: null },
    ]);
    expect(cols('ticket_handoffs')).toEqual(
      expect.arrayContaining(['ticket_key', 'decision', 'to_assignee', 'to_department']),
    );
    expect(cols('handoff_reads')).toEqual(['handoff_id', 'user_id', 'read_at']);
  });

  it('is a no-op the second time', () => {
    runMigrations(db);
    const before = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
    expect(runMigrations(db)).toEqual([]);
    expect(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all()).toEqual(
      before,
    );
  });

  it('adopts a database that has the tables but no bookkeeping, without error', () => {
    db.exec(BASELINE_SQL); // what v1 leaves behind before its ALTERs
    db.exec('ALTER TABLE tickets ADD COLUMN priority TEXT'); // partially upgraded
    expect(() => runMigrations(db)).not.toThrow();
    expect(cols('tickets').filter((c) => ['priority', 'labels', 'due_date'].includes(c))).toEqual(
      TICKET_EXTRA_COLUMNS.map(([name]) => name),
    );
  });

  it('keeps existing rows byte for byte', () => {
    db.exec(BASELINE_SQL);
    db.prepare("INSERT INTO users (email, name, password) VALUES ('a@b.c', 'A', 'hash')").run();
    db.prepare(
      "INSERT INTO tickets (project_slug, board_slug, key, title, type, status) VALUES ('p','b','K-1','t','task','Backlog')",
    ).run();
    runMigrations(db);
    expect(db.prepare('SELECT * FROM users').all()).toEqual([
      expect.objectContaining({ email: 'a@b.c', password: 'hash' }),
    ]);
    expect(db.prepare('SELECT priority, labels, due_date FROM tickets').all()).toEqual([
      { priority: null, labels: null, due_date: null },
    ]);
  });

  it('rolls a failing migration back and does not record it', () => {
    const boom: Migration = {
      name: '0001-boom',
      up(d) {
        d.exec('CREATE TABLE half_done (x INTEGER)');
        throw new Error('boom');
      },
    };
    runMigrations(db);
    expect(() => runMigrations(db, [...[{ name: '0000-baseline', up() {} }], boom])).toThrow(
      'boom',
    );
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get(),
    ).toBeUndefined();
    expect(
      db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE} WHERE name = '0001-boom'`).get(),
    ).toBeUndefined();
  });

  it('applies a later migration once, after the baseline', () => {
    const later: Migration = {
      name: '0001-extra',
      up: (d) => d.exec('CREATE TABLE IF NOT EXISTS extra (id INTEGER PRIMARY KEY)'),
    };
    runMigrations(db);
    const base = { name: '0000-baseline', up() {} };
    expect(runMigrations(db, [base, later])).toEqual(['0001-extra']);
    expect(runMigrations(db, [base, later])).toEqual([]);
  });

  it('rejects duplicate or unordered migration lists', () => {
    const m = (name: string): Migration => ({ name, up() {} });
    expect(() => runMigrations(db, [m('0001-a'), m('0001-a')])).toThrow(/duplicate/);
    expect(() => runMigrations(db, [m('0002-b'), m('0001-a')])).toThrow(/order/);
  });
});
