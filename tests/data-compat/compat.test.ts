// Proves the v2 data layer works on databases v1 already created, and that v1 still
// works on them afterwards (rollback safety). For every fixture and for an empty
// database the same suite runs, in order, on one temp data directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allocateTicketKey } from '../../apps/server/src/db/counters.js';
import { MIGRATIONS, MIGRATIONS_TABLE } from '../../apps/server/src/db/migrate.js';
import { openDatabase } from '../../apps/server/src/db/open.js';
import { resolveStoredPath } from '../../apps/server/src/db/paths.js';
import {
  emptyFixture,
  movedUploadsFixture,
  partialColumnFixture,
  preColumnFixture,
  seededFixture,
  type Fixture,
} from './support/fixtures.js';
import {
  V2_ADDITIONS,
  client,
  dumpRows,
  freshLegacySnapshot,
  snapshot,
  startLegacy,
} from './support/legacy.js';

const dbFile = (fx: Fixture) => path.join(fx.dataDir, 'pm.db');

/** Reads a database without going through v2, so "before" is genuinely before. */
function readRows(fx: Fixture): Record<string, unknown[]> {
  if (!fs.existsSync(dbFile(fx))) return {};
  const db = new Database(dbFile(fx), { readonly: true });
  try {
    return dumpRows(db);
  } finally {
    db.close();
  }
}

/** Every row that existed before must still exist, unchanged, in the columns it had. */
function expectRowsPreserved(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
  for (const [table, rows] of Object.entries(before)) {
    const now = after[table] ?? [];
    expect(now.length, `${table} row count`).toBe(rows.length);
    rows.forEach((row, i) => {
      const r = row as Record<string, unknown>;
      const projected = Object.fromEntries(
        Object.keys(r).map((k) => [k, (now[i] as Record<string, unknown>)[k]]),
      );
      expect(projected, `${table} row ${i}`).toEqual(r);
    });
  }
}

function withDb<T>(fx: Fixture, fn: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase({ dataDir: fx.dataDir });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Extra assertions that only make sense for the moved-uploads fixture. */
function movedUploadsChecks(getFx: () => Fixture) {
  type FileRow = { id: string; stored_path: string; original_name: string };
  let ticketRows: FileRow[];
  let projectRows: FileRow[];

  beforeAll(() => {
    const db = new Database(dbFile(getFx()), { readonly: true });
    ticketRows = db
      .prepare('SELECT id, stored_path, original_name FROM ticket_files')
      .all() as FileRow[];
    projectRows = db
      .prepare('SELECT id, stored_path, original_name FROM project_files')
      .all() as FileRow[];
    db.close();
  });

  it('starts with stored paths that point at a directory that no longer exists', () => {
    expect(ticketRows).toHaveLength(1);
    expect(projectRows).toHaveLength(1);
    for (const row of [...ticketRows, ...projectRows]) {
      expect(path.isAbsolute(row.stored_path)).toBe(true);
      expect(row.stored_path.startsWith(getFx().upload!.oldDataDir + path.sep)).toBe(true);
      expect(fs.existsSync(row.stored_path)).toBe(false);
    }
  });

  it('resolveStoredPath finds both files under the current directory', () => {
    const fx = getFx();
    const uploadsRoot = fs.realpathSync(path.join(fx.dataDir, 'uploads'));
    for (const [row, bytes] of [
      [ticketRows[0]!, 'ticket upload bytes'],
      [projectRows[0]!, 'project upload bytes'],
    ] as const) {
      const found = resolveStoredPath(fx.dataDir, row.stored_path);
      expect(found, row.original_name).not.toBeNull();
      expect(fs.realpathSync(found!).startsWith(uploadsRoot + path.sep)).toBe(true);
      expect(fs.readFileSync(found!, 'utf8')).toBe(bytes);
    }
  });

  it('does not rewrite the rows, so a rollback to v1 sees what it wrote', () => {
    withDb(getFx(), (db) => {
      expect(
        db.raw.prepare('SELECT id, stored_path, original_name FROM ticket_files').all(),
      ).toEqual(ticketRows);
      expect(
        db.raw.prepare('SELECT id, stored_path, original_name FROM project_files').all(),
      ).toEqual(projectRows);
    });
  });

  it('never hands out a file that exists only at the old location', () => {
    const fx = getFx();
    const decoy = ticketRows[0]!.stored_path;
    fs.mkdirSync(path.dirname(decoy), { recursive: true });
    fs.writeFileSync(decoy, 'outside the data dir');
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-compat-nodata-'));
    try {
      expect(resolveStoredPath(elsewhere, decoy)).toBeNull();
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
      fs.rmSync(fx.upload!.oldDataDir, { recursive: true, force: true });
    }
  });
}

const reference = freshLegacySnapshot();

const cases: Array<{
  label: string;
  build: () => Fixture | Promise<Fixture>;
  extra?: (getFx: () => Fixture) => void;
}> = [
  { label: 'empty database', build: emptyFixture },
  { label: '(a) v1 database seeded by seed-demo.js', build: seededFixture },
  { label: '(b) old shape without priority, labels, due_date', build: preColumnFixture },
  { label: '(b2) old shape with only priority', build: partialColumnFixture },
  {
    label: '(c) v1 database whose uploads were moved',
    build: movedUploadsFixture,
    extra: movedUploadsChecks,
  },
];

describe.each(cases)('$label', ({ build, extra }) => {
  let fx: Fixture;
  let before: Record<string, unknown[]>;
  let nextKey = 1; // what the FOOD-ENG counter says before any v2 allocation

  beforeAll(async () => {
    fx = await build();
    before = readRows(fx);
    const counter = (before.counters as Array<{ prefix: string; next: number }> | undefined)?.find(
      (c) => c.prefix === 'FOOD-ENG',
    );
    nextKey = counter?.next ?? 1;
  });
  afterAll(() => {
    for (const dir of [fx?.dataDir, fx?.upload?.oldDataDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates without error and records every migration', () => {
    const all = MIGRATIONS.map((m) => m.name);
    expect(all[0]).toBe('0000-baseline');
    const opened = withDb(fx, (db) => db.applied);
    expect(opened).toEqual(all);
    withDb(fx, (db) => {
      const names = db.raw.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all();
      expect(names).toEqual(all.map((name) => ({ name })));
    });
  });

  it('is idempotent: running it again applies nothing and changes nothing', () => {
    const snap1 = withDb(fx, (db) => snapshot(db.raw));
    const rows1 = readRows(fx);
    withDb(fx, (db) => expect(db.applied).toEqual([]));
    withDb(fx, (db) => expect(db.applied).toEqual([]));
    expect(withDb(fx, (db) => snapshot(db.raw))).toEqual(snap1);
    expect(readRows(fx)).toEqual(rows1);
  });

  it('has the same schema as a database v1 creates itself', () => {
    const snap = withDb(fx, (db) => snapshot(db.raw));
    expect(snap.master).toEqual(reference.master);
    expect(snap.tableInfo).toEqual(reference.tableInfo);
    // The only intended extras: the migration bookkeeping table and what the additive
    // migrations declare in V2_ADDITIONS (their tables, indexes and primary-key indexes).
    expect(V2_ADDITIONS.tables).toEqual([
      'ticket_handoffs',
      'handoff_reads',
      'ticket_participants',
      'handoff_recipients',
      'project_phases',
    ]);
    expect([...snap.extras].sort()).toEqual([
      '_officepm_migrations',
      'handoff_reads',
      'handoff_recipients',
      'idx_handoff_recipients_user',
      'idx_project_phases_project',
      'idx_ticket_handoffs_assignee',
      'idx_ticket_handoffs_ticket',
      'idx_ticket_participants_user',
      'project_phases',
      'sqlite_autoindex__officepm_migrations_1',
      'sqlite_autoindex_handoff_reads_1',
      'sqlite_autoindex_handoff_recipients_1',
      'sqlite_autoindex_project_phases_1',
      'sqlite_autoindex_ticket_handoffs_1',
      'sqlite_autoindex_ticket_participants_1',
      'ticket_handoffs',
      'ticket_participants',
    ]);
  });

  it('leaves every existing row untouched', () => {
    expectRowsPreserved(before, readRows(fx));
  });

  it('keeps bcrypt hashes verifiable', () => {
    const users = withDb(fx, (db) =>
      db.raw.prepare('SELECT email, password FROM users').all(),
    ) as Array<{ email: string; password: string }>;
    expect(users.length).toBe(fx.knownPasswords.length);
    for (const known of fx.knownPasswords) {
      const row = users.find((u) => u.email === known.email);
      expect(row, known.email).toBeDefined();
      expect(row!.password.startsWith('$2'), 'is a bcrypt hash').toBe(true);
      expect(bcrypt.compareSync(known.password, row!.password), known.email).toBe(true);
      expect(bcrypt.compareSync('not-the-password', row!.password)).toBe(false);
    }
  });

  it('continues ticket keys at the counter, never reusing one', () => {
    withDb(fx, (db) => {
      const tickets = db.raw.prepare('SELECT key FROM tickets').all() as Array<{ key: string }>;
      const counters = db.raw.prepare('SELECT prefix, next FROM counters').all() as Array<{
        prefix: string;
        next: number;
      }>;
      for (const { prefix, next } of counters) {
        const numbers = tickets
          .filter((t) => t.key.slice(0, t.key.lastIndexOf('-')) === prefix)
          .map((t) => Number(t.key.slice(t.key.lastIndexOf('-') + 1)));
        const max = numbers.length ? Math.max(...numbers) : 0;
        expect(next, `${prefix} counter vs highest key ${max}`).toBeGreaterThan(max);
      }
      expect(tickets.map((t) => t.key)).not.toContain(`FOOD-ENG-${nextKey}`);
      expect(allocateTicketKey(db.raw, 'FOOD-ENG')).toBe(`FOOD-ENG-${nextKey}`);
      expect(allocateTicketKey(db.raw, 'FOOD-ENG')).toBe(`FOOD-ENG-${nextKey + 1}`);
    });
  });

  it('still boots v1 on the migrated database and serves it', async () => {
    const srv = await startLegacy(fx.dataDir);
    try {
      const c = client(srv.base);
      const me = (await c.login(fx.login)) as { email: string; isAdmin: boolean };
      expect(me.email).toBe(fx.login.email);

      const overview = await c.get('/api/overview');
      expect(overview.status).toBe(200);
      const rows = (await overview.json()) as unknown[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(7);

      // v1 continues from the counter v2 advanced: nextKey and nextKey + 1 were taken above.
      const created = await c.post('/api/tickets', {
        project_slug: 'food',
        board_slug: 'eng',
        title: 'created by v1 after a v2 migration',
        type: 'task',
      });
      expect(created.status).toBe(201);
      expect(((await created.json()) as { key: string }).key).toBe(`FOOD-ENG-${nextKey + 2}`);
    } finally {
      await srv.stop();
    }
  });

  it('is still current for v2 after v1 has booted on it', () => {
    withDb(fx, (db) => {
      expect(db.applied).toEqual([]);
      const snap = snapshot(db.raw);
      expect(snap.master).toEqual(reference.master);
      expect(snap.tableInfo).toEqual(reference.tableInfo);
    });
  });

  extra?.(() => fx);
});
