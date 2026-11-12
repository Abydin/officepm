// Everything that touches the frozen v1 code (frozen-v1/): its schema, its seed script
// and its server. Every spawn is pinned to a throwaway PM_DATA_DIR, because with it unset
// v1 falls back to a directory inside the repository instead of a temp one.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);

const FROZEN_V1 = path.join(here, '..', 'frozen-v1');
// v1 resolves projects.json relative to its own location, which is no longer the repo root.
const PROJECTS_FILE = path.join(REPO_ROOT, 'projects.json');

export const legacySchema = require(path.join(FROZEN_V1, 'schema.js')) as {
  SCHEMA_SQL: string;
  migrate(db: Database.Database): void;
};

export const DEMO_LOGIN = { email: 'maya.okafor@officepm.demo', password: 'demo-password' };
export const BOOTSTRAP_ADMIN = { email: 'admin@officepm.local', password: 'compat-admin-password' };

export function makeTempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `officepm-compat-${label}-`));
}

/** Refuses anything that is not inside the OS temp dir, so a bug cannot touch real data. */
function assertThrowaway(dir: string): string {
  const real = fs.realpathSync(path.resolve(dir));
  const tmp = fs.realpathSync(os.tmpdir());
  if (!real.startsWith(tmp + path.sep) || real === fs.realpathSync(REPO_ROOT)) {
    throw new Error('refusing to use a non-temporary data dir: ' + dir);
  }
  return dir;
}

/** Runs frozen-v1/scripts/seed-demo.js into an empty data dir. */
export function seedDemo(dataDir: string): void {
  assertThrowaway(dataDir);
  const res = spawnSync(process.execPath, [path.join(FROZEN_V1, 'scripts', 'seed-demo.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, PM_DATA_DIR: dataDir, PM_PROJECTS_FILE: PROJECTS_FILE },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error('seed-demo failed: ' + res.stdout + res.stderr);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

export interface LegacyServer {
  base: string;
  output(): string;
  stop(): Promise<void>;
}

/** Boots `node frozen-v1/server.js` against dataDir and waits until it answers. */
export async function startLegacy(dataDir: string, admin = BOOTSTRAP_ADMIN): Promise<LegacyServer> {
  assertThrowaway(dataDir);
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(FROZEN_V1, 'server.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PM_DATA_DIR: dataDir,
      PM_PROJECTS_FILE: PROJECTS_FILE,
      PM_TOKEN: 'compat-pm-token',
      NODE_ENV: 'test',
      ADMIN_EMAIL: admin.email,
      ADMIN_PASSWORD: admin.password,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));

  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));
    }
  };
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`v1 exited with ${child.exitCode}:\n${output}`);
    try {
      await fetch(base + '/api/me'); // any HTTP answer (401) means it is up
      break;
    } catch {
      if (Date.now() > deadline) {
        await stop();
        throw new Error('v1 did not come up in 15s:\n' + output);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  return { base, output: () => output, stop };
}

/** A tiny cookie-carrying client. */
export function client(base: string) {
  let cookie = '';
  async function req(method: string, url: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) cookie = c.split(';')[0] ?? cookie;
    return res;
  }
  return {
    get: (u: string) => req('GET', u),
    post: (u: string, b?: unknown) => req('POST', u, b),
    async login(creds: { email: string; password: string }) {
      const res = await req('POST', '/api/login', creds);
      if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}

// ---- schema snapshots ---------------------------------------------------------

export interface Snapshot {
  master: Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  tableInfo: Record<string, unknown[]>;
  /** Object names left out of the comparison (v2 bookkeeping). */
  extras: string[];
}

const squash = (s: string | null) => (s === null ? null : s.replace(/\s+/g, ' ').trim());

/**
 * What v2's additive migrations (0001 and later) put on top of v1's schema. Anything
 * listed here is set aside, so the comparison with v1 still covers every v1 object and
 * fails on any change that is not declared here. A migration that adds something adds
 * it here too, in the same commit.
 */
export const V2_ADDITIONS = {
  /** New tables, with their indexes and automatic primary-key indexes. */
  tables: ['ticket_handoffs', 'handoff_reads', 'ticket_participants', 'handoff_recipients'],
  /** New nullable columns on v1 tables. */
  columns: { users: ['department'], tickets: ['subticket_of'] } as Record<string, string[]>,
};

const isExtra = (name: string) =>
  name.startsWith('_officepm_') ||
  name.startsWith('sqlite_autoindex__officepm_') ||
  V2_ADDITIONS.tables.some(
    (t) => name === t || name.startsWith(`idx_${t}_`) || name.startsWith(`sqlite_autoindex_${t}_`),
  );

/** `ALTER TABLE ... ADD COLUMN` appends to the stored CREATE text, so take the column back out of it. */
function withoutAddedColumns(table: string, sql: string | null): string | null {
  let out = sql;
  for (const column of V2_ADDITIONS.columns[table] ?? []) {
    out = out && out.replace(new RegExp(`,\\s*${column}\\s+\\w+(?=\\s*\\)\\s*$)`), '');
  }
  return out;
}

export function snapshot(db: Database.Database): Snapshot {
  const all = db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
    .all() as Snapshot['master'];
  const extras = all.filter((r) => isExtra(r.name) || isExtra(r.tbl_name)).map((r) => r.name);
  const master = all
    .filter((r) => !extras.includes(r.name))
    .map((r) => ({ ...r, sql: withoutAddedColumns(r.tbl_name, squash(r.sql)) }));
  const tableInfo: Record<string, unknown[]> = {};
  for (const t of master.filter((r) => r.type === 'table')) {
    const added = V2_ADDITIONS.columns[t.name] ?? [];
    tableInfo[t.name] = (
      db.prepare(`PRAGMA table_info(${t.name})`).all() as Array<{ name: string }>
    ).filter((c) => !added.includes(c.name));
  }
  return { master, tableInfo, extras };
}

/** The reference: what v1's own migrate() builds on a blank database. */
export function freshLegacySnapshot(): Snapshot {
  const db = new Database(':memory:');
  try {
    legacySchema.migrate(db);
    return snapshot(db);
  } finally {
    db.close();
  }
}

/** Every row of every table, by explicit column list, for before/after equality. */
export function dumpRows(db: Database.Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  for (const { name } of tables) {
    if (isExtra(name)) continue;
    out[name] = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
  }
  return out;
}
