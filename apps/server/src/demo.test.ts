import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_MAX_JSON_BYTES,
  DEMO_REFUSAL,
  DEMO_WRITES_PER_CLIENT,
  ensureDemoWorkspace,
  isDemoBlocked,
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
    // The login above was the first write.
    for (let i = 1; i < DEMO_WRITES_PER_CLIENT; i++) {
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
