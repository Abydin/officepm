import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApp,
  EventBus,
  loadConfig,
  openDatabase,
  ProjectsRegistry,
  readProjectsConfig,
  type AppContext,
  type OpenDatabase,
} from '../index.js';
import { seedDemo, SeedRefusal } from './demo.js';
import { COMMENTS, DEMO_PASSWORD, TICKETS, USERS } from './demo-data.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PROJECTS_FILE = path.join(REPO_ROOT, 'projects.json');
const LEGACY_SEED = path.join(
  REPO_ROOT,
  'tests',
  'data-compat',
  'frozen-v1',
  'scripts',
  'seed-demo.js',
);

const registry = () => new ProjectsRegistry(readProjectsConfig(PROJECTS_FILE));
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `officepm-${name}-`));

const dirs: string[] = [];
const dbs: OpenDatabase[] = [];
function freshDb(): { dir: string; db: OpenDatabase } {
  const dir = tmp('seed');
  dirs.push(dir);
  const db = openDatabase({ dataDir: dir });
  dbs.push(db);
  return { dir, db };
}
afterAll(() => {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('demo seeder', () => {
  it('writes the demo workspace and the documented login verifies', () => {
    const { db } = freshDb();
    const summary = seedDemo(db, registry());
    expect(summary.tickets).toBe(TICKETS.length);
    expect(summary.users).toBe(USERS.length);
    const row = db.raw
      .prepare('SELECT password, is_admin FROM users WHERE email = ?')
      .get('maya.okafor@officepm.demo') as { password: string; is_admin: number };
    expect(row.is_admin).toBe(1);
    expect(bcrypt.compareSync(DEMO_PASSWORD, row.password)).toBe(true);
    const comments = db.raw.prepare('SELECT COUNT(*) AS n FROM comments').get() as { n: number };
    expect(comments.n).toBe(COMMENTS.length + 1); // plus the bot comment on the PR ticket
  });

  it('puts tickets only on the statuses and types their board declares, and advances the key counters', () => {
    const { db } = freshDb();
    const reg = registry();
    seedDemo(db, reg);
    for (const { project, board } of reg.allBoards()) {
      const rows = db.raw
        .prepare('SELECT key, status, type FROM tickets WHERE project_slug = ? AND board_slug = ?')
        .all(project.slug, board.slug) as Array<{ key: string; status: string; type: string }>;
      expect(rows.length, `${project.slug}/${board.slug} has tickets`).toBeGreaterThan(0);
      for (const r of rows) {
        expect(board.statuses).toContain(r.status);
        expect(board.types).toContain(r.type);
        expect(r.key.startsWith(board.prefix + '-')).toBe(true);
      }
      const next = (
        db.raw.prepare('SELECT next FROM counters WHERE prefix = ?').get(board.prefix) as {
          next: number;
        }
      ).next;
      expect(next).toBe(rows.length + 1);
    }
  });

  it('refuses a database that has tickets, and writes nothing', () => {
    const { db } = freshDb();
    seedDemo(db, registry());
    const before = db.raw.prepare('SELECT COUNT(*) AS n FROM comments').get();
    expect(() => seedDemo(db, registry(), { allowExistingUsers: true })).toThrow(SeedRefusal);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM comments').get()).toEqual(before);
  });

  it('refuses a data directory that already has users unless told otherwise', () => {
    const { db } = freshDb();
    db.raw
      .prepare('INSERT INTO users (email, name, password, is_admin) VALUES (?,?,?,1)')
      .run('admin@example.com', 'Admin', 'x');
    expect(() => seedDemo(db, registry())).toThrow(/not a fresh data directory/);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n).toBe(0);
    seedDemo(db, registry(), { allowExistingUsers: true });
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(
      USERS.length + 1,
    );
  });

  it('is what the server boots on: login works and the seeded tickets come back over HTTP', async () => {
    const { dir, db } = freshDb();
    seedDemo(db, registry());
    const ctx: AppContext = {
      config: loadConfig({ PM_DATA_DIR: dir, ADMIN_PASSWORD: 'unused' }),
      db,
      projects: registry(),
      events: new EventBus(),
      dashboardCache: new Map(),
    };
    const app = createApp(ctx);
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'maya.okafor@officepm.demo', password: DEMO_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const list = await app.request('/api/tickets', { headers: { cookie } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBe(TICKETS.length);
  });
});

// The frozen v1 script is the reference. Ids are random UUIDs and dates are relative
// to the moment of the run, so rows are compared on content, not on ids or timestamps.
describe.skipIf(!fs.existsSync(LEGACY_SEED))(
  'demo seeder matches frozen-v1/scripts/seed-demo.js',
  () => {
    let v1: OpenDatabase;
    let v2: OpenDatabase;

    beforeAll(() => {
      const v1Dir = tmp('seed-v1');
      dirs.push(v1Dir);
      const run = spawnSync(process.execPath, [LEGACY_SEED], {
        cwd: REPO_ROOT,
        env: { ...process.env, PM_DATA_DIR: v1Dir, PM_PROJECTS_FILE: PROJECTS_FILE },
        encoding: 'utf8',
      });
      expect(run.status, run.stderr).toBe(0);
      v1 = openDatabase({ dataDir: v1Dir });
      dbs.push(v1);
      v2 = freshDb().db;
      seedDemo(v2, registry());
    });

    const same = (sql: string) => {
      const a = v1.raw.prepare(sql).all();
      const b = v2.raw.prepare(sql).all();
      expect(b).toEqual(a);
      return a.length;
    };

    it('has the same boards, users and counters', () => {
      expect(same('SELECT * FROM board_settings ORDER BY project_slug, board_slug')).toBe(7);
      expect(same('SELECT * FROM counters ORDER BY prefix')).toBe(7);
      expect(same('SELECT email, name, is_admin FROM users ORDER BY email')).toBe(USERS.length);
    });

    it('has the same tickets, field for field apart from dates and sprint ids', () => {
      const n =
        same(`SELECT project_slug, board_slug, key, title, type, status, assignee, parent_key, level,
      description, acceptance_criteria, points, appetite, sprint_id IS NOT NULL AS in_sprint, blocked,
      blocker_reason, priority, labels, due_date IS NOT NULL AS has_due FROM tickets ORDER BY key`);
      expect(n).toBe(TICKETS.length);
    });

    it('has the same sprints, comments, checklists, links, docs, retro and GitHub rows', () => {
      same('SELECT project_slug, board_slug, name, kind, status FROM sprints ORDER BY name');
      same('SELECT ticket_key, author, body, source FROM comments ORDER BY ticket_key, body');
      same('SELECT ticket_key, item, done FROM ticket_dod ORDER BY ticket_key, item');
      same('SELECT ticket_key, title, url, author FROM ticket_links ORDER BY ticket_key');
      same('SELECT project_slug, title, kind, url, body, author FROM project_docs ORDER BY title');
      same('SELECT project_slug, board_slug, name, status FROM retros');
      same('SELECT column_name, body, author, ticket_key FROM retro_cards ORDER BY body');
      same('SELECT ticket_key, kind, repo, ref, url, actor, environment FROM github_links');
    });

    it('has the same schema', () => {
      const schema = (db: OpenDatabase) =>
        db.raw
          .prepare(
            "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '%officepm_migrations%' AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
          )
          .all();
      expect(schema(v2)).toEqual(schema(v1));
    });
  },
);
