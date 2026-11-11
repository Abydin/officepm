// Builds the v1-era databases at test time. Nothing here is committed as a binary
// .db; every fixture is made fresh in a temp directory by v1's own code.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import {
  BOOTSTRAP_ADMIN,
  DEMO_LOGIN,
  client,
  legacySchema,
  makeTempDir,
  seedDemo,
  startLegacy,
} from './legacy.js';

export interface Login {
  email: string;
  password: string;
}

export interface Fixture {
  name: string;
  dataDir: string;
  /** Credentials that must work against v1 once the database is migrated. */
  login: Login;
  /** Users whose bcrypt hash must still verify, with the password to try. */
  knownPasswords: Array<{ email: string; password: string }>;
  /** True when the fixture has no pm.db at all before the first v2 open. */
  noDatabaseYet?: boolean;
  /** Set only for the moved-uploads fixture. */
  upload?: { oldDataDir: string };
}

const OLD_PASSWORD = 'old-password';

/** (empty) No database at all. v2 must create the whole schema from nothing. */
export function emptyFixture(): Fixture {
  return {
    name: 'empty',
    dataDir: makeTempDir('empty'),
    login: BOOTSTRAP_ADMIN,
    knownPasswords: [],
    noDatabaseYet: true,
  };
}

/** (a) A real v1 database: frozen-v1 schema.js migrate(), then frozen-v1 seed-demo.js. */
export function seededFixture(): Fixture {
  const dataDir = makeTempDir('seeded');
  seedDemo(dataDir);
  const db = new Database(path.join(dataDir, 'pm.db'));
  const users = db.prepare('SELECT email FROM users').all() as Array<{ email: string }>;
  db.close();
  return {
    name: 'v1 seeded by seed-demo.js',
    dataDir,
    login: DEMO_LOGIN,
    knownPasswords: users.map((u) => ({ email: u.email, password: DEMO_LOGIN.password })),
  };
}

/**
 * Inserts a small hand-made workspace into a database that has the OLD tickets
 * shape (no priority, labels or due_date). seed-demo.js cannot be used for these
 * because it writes those columns.
 */
function insertOldWorkspace(db: Database.Database): void {
  const hash = bcrypt.hashSync(OLD_PASSWORD, 10);
  db.prepare('INSERT INTO users (email, name, password, is_admin) VALUES (?,?,?,1)').run(
    'old.admin@officepm.test',
    'Old Admin',
    hash,
  );
  const ticket = db.prepare(
    `INSERT INTO tickets (project_slug, board_slug, key, title, type, status, assignee, points)
     VALUES ('food','eng',?,?,?,?,?,?)`,
  );
  ticket.run('FOOD-ENG-1', 'First', 'story', 'Backlog', 'Old Admin', 3);
  ticket.run('FOOD-ENG-2', 'Second', 'task', 'In Progress', null, null);
  ticket.run('FOOD-ENG-3', 'Third', 'bug', 'Done', 'Old Admin', 1);
  // Ticket 4 was created and then deleted: the counter is ahead of MAX(n)+1.
  db.prepare("INSERT INTO counters (prefix, next) VALUES ('FOOD-ENG', 5)").run();
  db.prepare(
    "INSERT INTO comments (ticket_key, author, body) VALUES ('FOOD-ENG-1','Old Admin','hello')",
  ).run();
}

/**
 * (b) The pre-column shape. frozen-v1/schema.js keeps the three tickets columns OUT
 * of its CREATE TABLE and adds them with ALTER TABLE in migrate(). So running only
 * SCHEMA_SQL and skipping migrate() gives, by construction, the database an
 * install from before those columns existed would have.
 */
export function preColumnFixture(): Fixture {
  const dataDir = makeTempDir('precolumn');
  const db = new Database(path.join(dataDir, 'pm.db'));
  db.pragma('journal_mode = WAL');
  db.exec(legacySchema.SCHEMA_SQL);
  const cols = (db.prepare('PRAGMA table_info(tickets)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (cols.some((c) => ['priority', 'labels', 'due_date'].includes(c))) {
    throw new Error('fixture is not the pre-column shape: ' + cols.join(','));
  }
  insertOldWorkspace(db);
  db.close();
  return {
    name: 'old shape, no priority/labels/due_date',
    dataDir,
    login: { email: 'old.admin@officepm.test', password: OLD_PASSWORD },
    knownPasswords: [{ email: 'old.admin@officepm.test', password: OLD_PASSWORD }],
  };
}

/** (b2) Half upgraded: priority exists, labels and due_date do not. */
export function partialColumnFixture(): Fixture {
  const dataDir = makeTempDir('partialcolumn');
  const db = new Database(path.join(dataDir, 'pm.db'));
  db.pragma('journal_mode = WAL');
  db.exec(legacySchema.SCHEMA_SQL);
  db.exec('ALTER TABLE tickets ADD COLUMN priority TEXT');
  insertOldWorkspace(db);
  db.close();
  return {
    name: 'old shape with only priority',
    dataDir,
    login: { email: 'old.admin@officepm.test', password: OLD_PASSWORD },
    knownPasswords: [{ email: 'old.admin@officepm.test', password: OLD_PASSWORD }],
  };
}

/**
 * (c) A v1 database whose uploads were written under a different absolute path.
 * Real v1 does the writing: seed, boot v1, upload through its API, stop it, then
 * move the whole data directory so every stored_path points at a place that no
 * longer exists.
 */
export async function movedUploadsFixture(): Promise<Fixture> {
  const oldDataDir = makeTempDir('uploads-old');
  seedDemo(oldDataDir);
  const srv = await startLegacy(oldDataDir);
  try {
    const c = client(srv.base);
    await c.login(DEMO_LOGIN);
    const ticketForm = new FormData();
    ticketForm.append('file', new Blob(['ticket upload bytes']), 'note.txt');
    const t = await c.post('/api/tickets/FOOD-ENG-1/files', ticketForm);
    if (t.status !== 201) throw new Error('ticket upload failed: ' + t.status + (await t.text()));
    const projectForm = new FormData();
    projectForm.append('file', new Blob(['project upload bytes']), 'spec.txt');
    const p = await c.post('/api/projects/food/files', projectForm);
    if (p.status !== 201) throw new Error('project upload failed: ' + p.status + (await p.text()));
  } finally {
    await srv.stop();
  }
  // Fold the WAL into pm.db so the move carries one consistent file.
  const db = new Database(path.join(oldDataDir, 'pm.db'));
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  const dataDir = oldDataDir + '-moved';
  fs.renameSync(oldDataDir, dataDir);
  const users = (() => {
    const d = new Database(path.join(dataDir, 'pm.db'));
    const rows = d.prepare('SELECT email FROM users').all() as Array<{ email: string }>;
    d.close();
    return rows;
  })();
  return {
    name: 'uploads written under another absolute path',
    dataDir,
    login: DEMO_LOGIN,
    knownPasswords: users.map((u) => ({ email: u.email, password: DEMO_LOGIN.password })),
    upload: { oldDataDir },
  };
}
