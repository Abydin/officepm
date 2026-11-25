import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertDemoDatabase,
  DEMO_LOGINS_PER_CLIENT,
  DEMO_MAX_JSON_BYTES,
  DEMO_MAX_STREAMS,
  DEMO_MAX_STREAMS_PER_SESSION,
  DEMO_REFUSAL,
  DEMO_WRITES_OVERALL,
  DEMO_WRITES_PER_CLIENT,
  DemoGuardError,
  ensureDemoWorkspace,
  isDemoBlocked,
  limitDemoDatabaseSize,
  looksPrivate,
  nextResetAt,
  resetDemoWorkspace,
  startDemoReset,
} from './demo.js';
import {
  createApp,
  EventBus,
  loadConfig,
  openDatabase,
  ProjectsRegistry,
  readProjectsConfig,
  type AppContext,
} from './index.js';
import { DEMO_PASSWORD, TICKETS } from './seed/demo-data.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(REPO_ROOT, 'apps', 'server', 'dist', 'main.js');
const MAYA = 'maya.okafor@officepm.demo';

const cleanups: Array<() => void> = [];
afterAll(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeCtx(env: Record<string, string> = {}): AppContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-demo-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    config: loadConfig({ PM_DATA_DIR: dir, DEMO_MODE: 'true', ...env }),
    db: openDatabase({ filename: ':memory:' }),
    projects: new ProjectsRegistry(readProjectsConfig(path.join(REPO_ROOT, 'projects.json'))),
    events: new EventBus(),
    dashboardCache: new Map(),
  };
}

const post = (body: unknown, cookie = '') => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

async function signIn(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request('/api/login', post({ email: MAYA, password: DEMO_PASSWORD }));
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const count = (ctx: AppContext, table: string) =>
  (ctx.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('DEMO_MODE configuration', () => {
  it('is off unless set, and then changes nothing', async () => {
    expect(loadConfig({ PM_DATA_DIR: '/tmp/x' }).demoMode).toBe(false);
    const ctx = makeCtx();
    ctx.config = loadConfig({ PM_DATA_DIR: '/tmp/x', ADMIN_PASSWORD: 'unit-test' });
    const app = createApp(ctx);
    const res = await app.request('/api/config');
    expect(await res.json()).toEqual({ demo: false });
    // Not the demo refusal: without DEMO_MODE the route is only behind its own login.
    expect((await app.request('/api/users', post({}))).status).toBe(401);
  });

  it('reads true, TRUE, 1 and yes, and refuses a value it does not recognise', () => {
    const on = (v: string) => loadConfig({ PM_DATA_DIR: '/tmp/x', DEMO_MODE: v }).demoMode;
    for (const v of ['true', 'TRUE', 'True', '1', 'yes', 'YES', ' true ']) expect(on(v)).toBe(true);
    for (const v of ['', 'false', 'FALSE', '0', 'no', 'off']) expect(on(v)).toBe(false);
    for (const v of ['ture', 'on', 'enabled', '2', 'y']) {
      expect(() => on(v), v).toThrow(/DEMO_MODE is set to an unrecognised value/);
    }
  });

  it('refuses to run without a data directory of its own', () => {
    expect(() => loadConfig({ DEMO_MODE: 'true' })).toThrow(/PM_DATA_DIR/);
    expect(loadConfig({ DEMO_MODE: '1', PM_DATA_DIR: '/tmp/x' }).demoMode).toBe(true);
  });
});

describe('demo mode over HTTP', () => {
  let ctx: AppContext;
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    app = createApp(ctx);
  });

  it('reports demo: true to a visitor who is not signed in', async () => {
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ demo: true });
  });

  it('seeds an empty database once, with no first-boot admin', async () => {
    expect(count(ctx, 'tickets')).toBe(TICKETS.length);
    expect(
      ctx.db.raw.prepare('SELECT 1 FROM users WHERE email = ?').get('admin@officepm.local'),
    ).toBe(undefined);
    expect(ensureDemoWorkspace(ctx)).toBe(false);
    expect(count(ctx, 'tickets')).toBe(TICKETS.length);
    await signIn(app);
  });

  it('refuses uploads, account changes, relays and webhooks with 403 demo_mode', async () => {
    const cookie = await signIn(app);
    const key = (ctx.db.raw.prepare('SELECT key FROM tickets LIMIT 1').get() as { key: string })
      .key;
    const form = new FormData();
    form.append('file', new Blob(['hello']), 'a.txt');
    const attempts: Array<[string, string, RequestInit]> = [
      ['POST', `/api/tickets/${key}/files`, { body: form }],
      ['POST', '/api/projects/food/files', { body: form }],
      ['POST', '/api/users', post({ email: 'x@y.z', name: 'X', password: 'longenough1' }, cookie)],
      ['PATCH', '/api/users/1/password', post({ password: 'longenough1' }, cookie)],
      ['PATCH', '/api/users/1/department', post({ department: 'QA' }, cookie)],
      [
        'POST',
        `/api/tickets/${key}/links`,
        post({ title: 't', url: 'https://example.com' }, cookie),
      ],
      [
        'POST',
        '/api/projects/food/docs',
        post({ title: 't', kind: 'link', url: 'https://example.com' }, cookie),
      ],
      ['POST', '/api/github/deploy', post({}, cookie)],
    ];
    for (const [method, url, init] of attempts) {
      const res = await app.request(url, {
        ...init,
        method,
        headers: { cookie, ...(init.headers as Record<string, string> | undefined) },
      });
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(await res.json(), `${method} ${url}`).toEqual({ error: DEMO_REFUSAL });
    }
    expect(DEMO_REFUSAL.startsWith('demo_mode')).toBe(true);
  });

  it('still lets visitors read, and write, the everyday things', async () => {
    const cookie = await signIn(app);
    const key = (ctx.db.raw.prepare('SELECT key FROM tickets LIMIT 1').get() as { key: string })
      .key;
    expect((await app.request('/api/tickets', { headers: { cookie } })).status).toBe(200);
    expect((await app.request('/api/users', { headers: { cookie } })).status).toBe(200);
    const comment = await app.request(`/api/tickets/${key}/comments`, post({ body: 'hi' }, cookie));
    expect(comment.status).toBe(201);
  });

  it('matches the blocked routes by write method only', () => {
    expect(isDemoBlocked('POST', '/api/users')).toBe(true);
    expect(isDemoBlocked('GET', '/api/users')).toBe(false);
    expect(isDemoBlocked('GET', '/api/tickets/FOOD-1/files/abc')).toBe(false);
    expect(isDemoBlocked('DELETE', '/api/tickets/FOOD-1/files/abc')).toBe(true);
    expect(isDemoBlocked('POST', '/api/tickets/FOOD-1/comments')).toBe(false);
  });

  it('caps a JSON body far below the stock 2 MB', async () => {
    const cookie = await signIn(app);
    const key = (ctx.db.raw.prepare('SELECT key FROM tickets LIMIT 1').get() as { key: string })
      .key;
    const big = 'x'.repeat(DEMO_MAX_JSON_BYTES + 1);
    const res = await app.request(`/api/tickets/${key}/comments`, post({ body: big }, cookie));
    expect(res.status).toBe(413);
  });

  it('holds a client to a handful of failed logins, fewer than the stock limit', async () => {
    const bad = () => app.request('/api/login', post({ email: MAYA, password: 'wrong-password' }));
    for (let i = 0; i < 5; i++) expect((await bad()).status).toBe(401);
    const sixth = await bad();
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('limits writes per client, and says when to retry', async () => {
    const cookie = await signIn(app);
    // Logins have their own bucket, so the first write is the first logout.
    for (let i = 0; i < DEMO_WRITES_PER_CLIENT; i++) {
      const res = await app.request('/api/logout', post({}, cookie));
      expect(res.status).toBe(200);
    }
    const over = await app.request('/api/logout', post({}, cookie));
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBeTruthy();
    // Reads are never counted.
    expect((await app.request('/api/config')).status).toBe(200);
  });
});

describe('demo limits', () => {
  it('keeps logins out of the write budget, in a tighter bucket of their own', async () => {
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    const app = createApp(ctx);
    for (let i = 0; i < DEMO_LOGINS_PER_CLIENT; i++) await signIn(app);
    const over = await app.request('/api/login', post({ email: MAYA, password: DEMO_PASSWORD }));
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    // The logins used none of the write budget.
    const res = await app.request('/api/logout', post({}));
    expect(res.status).toBe(200);
  });

  it('caps writes across every client at a number the 0.1 CPU can carry', () => {
    expect(DEMO_WRITES_OVERALL).toBeLessThanOrEqual(120);
  });

  it('caps open event streams per session and overall', async () => {
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    const app = createApp(ctx);
    const cookie = await signIn(app);
    const open = () => app.request('/api/events', { headers: { cookie } });
    const bodies = [];
    for (let i = 0; i < DEMO_MAX_STREAMS_PER_SESSION; i++) {
      const res = await open();
      expect(res.status).toBe(200);
      bodies.push(res);
    }
    const sixth = await open();
    expect(sixth.status).toBe(429);
    // Streams that end free their place.
    await bodies[0]!.body!.cancel();
    expect((await open()).status).toBe(200);
    // Another session still has room, until the whole demo is full.
    for (let i = ctx.events.size; i < DEMO_MAX_STREAMS; i++) {
      ctx.events.subscribe(() => {}, { userId: 1, sessionId: 'filler' + i, close: () => {} });
    }
    const full = await app.request('/api/events', { headers: { cookie: await signIn(app) } });
    expect(full.status).toBe(503);
  });

  it('logs how the client address resolved, as counts, for the first writes only', async () => {
    const ctx = makeCtx({ PM_TRUST_PROXY: '1' });
    ensureDemoWorkspace(ctx);
    const app = createApp(ctx);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (let i = 0; i < 8; i++) {
        await app.request('/api/logout', {
          ...post({}),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4, 10.0.0.9' },
        });
      }
      const lines = log.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('write request'));
      expect(lines).toHaveLength(5);
      expect(lines[0]).toContain('x-forwarded-for entries=2');
      expect(lines[0]).toContain('looks private=true');
      expect(lines.join('\n')).not.toMatch(/1\.2\.3\.4|10\.0\.0\.9/);
    } finally {
      log.mockRestore();
    }
  });

  it('knows a proxy-looking address from a public one', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(looksPrivate(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111', 'unknown']) {
      expect(looksPrivate(ip), ip).toBe(false);
    }
  });

  it('stops the database growing past its cap', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-cap-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const db = openDatabase({ dataDir: dir });
    const pages = limitDemoDatabaseSize(db, 512 * 1024);
    expect(db.raw.pragma('max_page_count', { simple: true })).toBe(pages);
    db.raw.exec('CREATE TABLE filler (v TEXT)');
    const fill = db.raw.prepare('INSERT INTO filler VALUES (?)');
    const chunk = 'x'.repeat(64 * 1024);
    expect(() => {
      for (let i = 0; i < 100; i++) fill.run(chunk);
    }).toThrow(/database or disk is full/);
    db.close();
  });
});

describe('the guard against a real database', () => {
  const insertUser = (ctx: AppContext, email: string) =>
    ctx.db.raw
      .prepare('INSERT INTO users (email, name, password) VALUES (?, ?, ?)')
      .run(email, 'Real Person', 'x');

  it('lets an empty database and a seeded demo database through', () => {
    const ctx = makeCtx();
    expect(() => assertDemoDatabase(ctx.db)).not.toThrow();
    ensureDemoWorkspace(ctx);
    expect(() => assertDemoDatabase(ctx.db)).not.toThrow();
  });

  it('makes boot throw on a database with a user outside @officepm.demo', () => {
    const ctx = makeCtx();
    insertUser(ctx, 'boss@example.com');
    expect(() => ensureDemoWorkspace(ctx)).toThrow(DemoGuardError);
    expect(count(ctx, 'tickets')).toBe(0);
    expect(count(ctx, 'users')).toBe(1);
  });

  it('makes boot throw on tickets with no demo user, and on a mix', () => {
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    insertUser(ctx, 'boss@example.com');
    expect(() => ensureDemoWorkspace(ctx)).toThrow(/not demo data/);

    const orphan = makeCtx();
    ensureDemoWorkspace(orphan);
    orphan.db.raw.pragma('foreign_keys = OFF');
    orphan.db.raw.prepare('DELETE FROM users').run();
    expect(() => ensureDemoWorkspace(orphan)).toThrow(DemoGuardError);
  });

  it('makes the reset delete nothing in a populated non-demo database', () => {
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    insertUser(ctx, 'boss@example.com');
    const before = {
      tickets: count(ctx, 'tickets'),
      users: count(ctx, 'users'),
      comments: count(ctx, 'comments'),
    };
    expect(() => resetDemoWorkspace(ctx)).toThrow(DemoGuardError);
    expect(count(ctx, 'tickets')).toBe(before.tickets);
    expect(count(ctx, 'users')).toBe(before.users);
    expect(count(ctx, 'comments')).toBe(before.comments);
    expect(
      ctx.db.raw.prepare('SELECT 1 FROM users WHERE email = ?').get('boss@example.com'),
    ).toBeTruthy();
  });

  it('survives the nightly timer: a refused reset logs an error and keeps the data', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-03-10T02:59:00Z'));
      const ctx = makeCtx();
      ensureDemoWorkspace(ctx);
      insertUser(ctx, 'boss@example.com');
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const stop = startDemoReset(ctx);
      vi.advanceTimersByTime(90_000);
      stop();
      expect(err).toHaveBeenCalled();
      err.mockRestore();
      expect(count(ctx, 'tickets')).toBe(TICKETS.length);
      expect(count(ctx, 'users')).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to start the real entry point on a database that is not demo data', async () => {
    execFileSync(
      path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc'),
      ['-b', 'packages/shared', 'apps/server'],
      { cwd: REPO_ROOT, stdio: 'pipe' },
    );
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-demoguard-'));
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const real = openDatabase({ dataDir });
    real.raw
      .prepare('INSERT INTO users (email, name, password) VALUES (?, ?, ?)')
      .run('boss@example.com', 'Real Person', 'x');
    real.close();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: '0',
      PM_DATA_DIR: dataDir,
      NODE_ENV: 'test',
      DEMO_MODE: 'yes',
    };
    const child = spawn(process.execPath, [MAIN], { cwd: REPO_ROOT, env });
    cleanups.push(() => child.kill('SIGKILL'));
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(1);
    expect(out).toContain('DEMO_MODE refused');
    expect(out).not.toContain('listening on');
    const after = openDatabase({ dataDir });
    const rows = after.raw.prepare('SELECT email FROM users').all();
    const boards = after.raw.prepare('SELECT COUNT(*) AS n FROM board_settings').get() as {
      n: number;
    };
    after.close();
    expect(rows).toEqual([{ email: 'boss@example.com' }]);
    // Nothing else was written before the guard ran: not even the board rows boot normally adds.
    expect(boards.n).toBe(0);
  }, 60_000);
});

describe('the nightly reset', () => {
  afterEach(() => vi.useRealTimers());

  it('puts the workspace back as seeded, ends old sessions and event streams', async () => {
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    const app = createApp(ctx);
    const cookie = await signIn(app);
    const key = (ctx.db.raw.prepare('SELECT key FROM tickets LIMIT 1').get() as { key: string })
      .key;
    await app.request(`/api/tickets/${key}/comments`, post({ body: 'vandalism' }, cookie));
    ctx.db.raw.prepare('DELETE FROM tickets WHERE key = ?').run(key);
    const closed = vi.fn();
    ctx.events.subscribe(() => {}, { userId: 1, sessionId: 's', close: closed });

    resetDemoWorkspace(ctx);

    expect(count(ctx, 'tickets')).toBe(TICKETS.length);
    expect(count(ctx, 'users')).toBeGreaterThan(1);
    expect(count(ctx, 'comments')).not.toBe(0);
    expect(ctx.db.raw.prepare("SELECT 1 FROM comments WHERE body = 'vandalism'").get()).toBe(
      undefined,
    );
    expect(closed).toHaveBeenCalled();
    expect((await app.request('/api/tickets', { headers: { cookie } })).status).toBe(401);
    expect(
      (await app.request('/api/tickets', { headers: { cookie: await signIn(app) } })).status,
    ).toBe(200);
    // New tickets are numbered from where the seed left off, not from a stale counter.
    const { type } = ctx.db.raw
      .prepare("SELECT type FROM tickets WHERE project_slug = 'food' AND board_slug = 'eng'")
      .get() as { type: string };
    const created = await app.request(
      '/api/tickets',
      post(
        { project_slug: 'food', board_slug: 'eng', title: 'after reset', type },
        await signIn(app),
      ),
    );
    expect(created.status).toBe(201);
    expect(count(ctx, 'tickets')).toBe(TICKETS.length + 1);
  });

  it('rolls back to yesterday when the reseed fails, instead of leaving an empty workspace', () => {
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    ctx.db.raw.prepare("UPDATE comments SET body = 'kept' WHERE rowid = 1").run();
    const real = ctx.projects;
    // A registry with no boards: the wipe goes through, then the seed refuses.
    ctx.projects = { allBoards: () => [], config: real.config } as unknown as typeof real;
    expect(() => resetDemoWorkspace(ctx)).toThrow();
    ctx.projects = real;
    expect(count(ctx, 'tickets')).toBe(TICKETS.length);
    expect(count(ctx, 'users')).toBeGreaterThan(1);
    expect(ctx.db.raw.prepare("SELECT 1 FROM comments WHERE body = 'kept'").get()).toBeTruthy();
  });

  it('finds the next 03:00 UTC strictly after now', () => {
    const iso = (s: string) => nextResetAt(new Date(s)).toISOString();
    expect(iso('2026-03-10T02:59:59Z')).toBe('2026-03-10T03:00:00.000Z');
    expect(iso('2026-03-10T03:00:00Z')).toBe('2026-03-11T03:00:00.000Z');
    expect(iso('2026-12-31T23:00:00Z')).toBe('2027-01-01T03:00:00.000Z');
  });

  it('runs when the clock reaches it, and again the next night', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T02:59:00Z'));
    const ctx = makeCtx();
    ensureDemoWorkspace(ctx);
    const stop = startDemoReset(ctx);
    ctx.db.raw.prepare('DELETE FROM tickets').run();
    vi.advanceTimersByTime(30_000);
    expect(count(ctx, 'tickets')).toBe(0);
    vi.advanceTimersByTime(40_000);
    expect(count(ctx, 'tickets')).toBe(TICKETS.length);
    ctx.db.raw.prepare('DELETE FROM tickets').run();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(count(ctx, 'tickets')).toBe(TICKETS.length);
    stop();
  });
});

describe('the real entry point in demo mode', () => {
  it('boots with the demo workspace, no generated admin, and refuses what it should', async () => {
    execFileSync(
      path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc'),
      ['-b', 'packages/shared', 'apps/server'],
      { cwd: REPO_ROOT, stdio: 'pipe' },
    );
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-demoboot-'));
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const port = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, () => {
        const { port: p } = s.address() as net.AddressInfo;
        s.close(() => resolve(p));
      });
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
      PM_DATA_DIR: dataDir,
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
    };
    delete env.ADMIN_PASSWORD;
    const child = spawn(process.execPath, [MAIN], { cwd: REPO_ROOT, env });
    cleanups.push(() => child.kill('SIGKILL'));
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    for (let i = 0; i < 200 && !out.includes('listening on'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(out).toContain('listening on');
    expect(out).not.toContain('Generated admin password');

    const base = 'http://127.0.0.1:' + port;
    expect(await (await fetch(base + '/api/config')).json()).toEqual({ demo: true });
    expect((await fetch(base + '/api/health')).status).toBe(200);
    const login = await fetch(base + '/api/login', post({ email: MAYA, password: DEMO_PASSWORD }));
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const refused = await fetch(base + '/api/users', post({ email: 'a@b.c' }, cookie));
    expect(refused.status).toBe(403);
  }, 60_000);
});
