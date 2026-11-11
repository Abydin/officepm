import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapAdmin,
  createApp,
  EventBus,
  loadConfig,
  openDatabase,
  ProjectsRegistry,
  seedBoards,
} from './index.js';
import { LoginThrottle } from './http/throttle.js';
import { MAX_JSON_BYTES, MAX_UPLOAD_REQUEST_BYTES } from './http/limits.js';
import { inlineScriptHashes } from './http/security-headers.js';
import { parseProjectsConfig } from './projects-config.js';
import type { AppContext } from './context.js';

const BOARD = {
  slug: 'eng',
  name: 'Engineering',
  prefix: 'FOOD-ENG',
  flow: 'scrum',
  agile: true,
  points: true,
  has_github: true,
  statuses: ['Backlog', 'In Progress', 'Code Review', 'QA', 'Done'],
  types: ['task', 'bug'],
  definition_of_done: ['tested'],
};
const WATERFALL = {
  slug: 'eng',
  name: 'Engineering',
  prefix: 'ACME-ENG',
  flow: 'waterfall',
  agile: false,
  points: false,
  has_github: true,
  statuses: ['Requirements', 'Design', 'Implementation', 'Testing', 'Deployed'],
  types: ['task'],
  done_statuses: ['Deployed'],
};
const PROJECTS = {
  projects: [
    { slug: 'food', name: 'Food', description: 'd', boards: [BOARD] },
    { slug: 'acme', name: 'Acme', description: 'd', boards: [WATERFALL] },
  ],
};

const ADMIN = { email: 'admin@officepm.local', password: 'unit-test-password' };

interface Harness {
  app: ReturnType<typeof createApp>;
  ctx: AppContext;
  dir: string;
}

async function harness(extra: Partial<AppContext> = {}, webDir?: string): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-hard-'));
  const ctx: AppContext = {
    config: loadConfig({
      PM_DATA_DIR: dir,
      PM_TOKEN: 'tok',
      ADMIN_PASSWORD: ADMIN.password,
      ...(webDir ? { PM_WEB_DIR: webDir } : {}),
    }),
    db: openDatabase({ filename: ':memory:' }),
    projects: new ProjectsRegistry(parseProjectsConfig(JSON.stringify(PROJECTS))),
    events: new EventBus(),
    dashboardCache: new Map(),
    ...extra,
  };
  seedBoards(ctx);
  await bootstrapAdmin(ctx);
  return { app: createApp(ctx), ctx, dir };
}

type Json = Record<string, unknown>;

function client(app: ReturnType<typeof createApp>) {
  let cookie = '';
  const request = async (method: string, url: string, init: RequestInit = {}) => {
    const res = await app.request(url, {
      ...init,
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) },
    });
    const set = res.headers.get('set-cookie');
    if (set && !/^pm_session=;/.test(set)) cookie = set.split(';')[0]!;
    return res;
  };
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await request(method, url, {
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Json, headers: res.headers };
  };
  const login = (email: string, password: string) =>
    call('POST', '/api/login', { email, password });
  return { request, call, login };
}

/** A body that yields `chunks` buffers of `size` bytes and records how many were pulled. */
function countedStream(chunks: number, size: number) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
  return { state, stream };
}

const post = (app: ReturnType<typeof createApp>, url: string, init: RequestInit) =>
  app.request(url, { method: 'POST', ...init, duplex: 'half' } as RequestInit);

describe('request size caps', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

  const jsonHeaders = { 'content-type': 'application/json' };

  it('refuses an oversize Content-Length with 413 without reading the body', async () => {
    const { state, stream } = countedStream(100, 64 * 1024);
    const res = await post(h.app, '/api/login', {
      headers: { ...jsonHeaders, 'content-length': String(100 * 64 * 1024) },
      body: stream,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'request body too large' });
    expect(state.pulled).toBeLessThan(5);
  });

  it('stops a chunked body that has no Content-Length at the cap', async () => {
    const chunks = 100;
    const { state, stream } = countedStream(chunks, 64 * 1024);
    const res = await post(h.app, '/api/login', { headers: jsonHeaders, body: stream });
    expect(res.status).toBe(413);
    // 2 MB is 32 chunks of 64 KB: it must stop near there, not read all 100.
    expect(state.pulled).toBeLessThan(MAX_JSON_BYTES / (64 * 1024) + 8);
    expect(state.pulled).toBeLessThan(chunks);
  });

  it('does not trust a Content-Length smaller than the real body', async () => {
    const { stream } = countedStream(50, 64 * 1024);
    const res = await post(h.app, '/api/login', {
      headers: { ...jsonHeaders, 'content-length': '10' },
      body: stream,
    });
    expect(res.status).toBe(413);
  });

  it('accepts a body exactly at the cap', async () => {
    const pad = MAX_JSON_BYTES - '{"email":"","password":"x"}'.length;
    const body = JSON.stringify({ email: 'a'.repeat(pad), password: 'x' });
    expect(Buffer.byteLength(body)).toBe(MAX_JSON_BYTES);
    const res = await post(h.app, '/api/login', { headers: jsonHeaders, body });
    expect(res.status).toBe(401);
  });

  const multipartStart =
    '--b\r\ncontent-disposition: form-data; name="file"; filename="a.txt"\r\n\r\n';
  const multipartEnd = '\r\n--b--\r\n';

  it('refuses an oversize upload while streaming, before parsing the form', async () => {
    const admin = client(h.app);
    await admin.login(ADMIN.email, ADMIN.password);
    const { state, stream } = countedStream(
      Math.ceil((MAX_UPLOAD_REQUEST_BYTES * 2) / (256 * 1024)),
      256 * 1024,
    );
    const total = Math.ceil((MAX_UPLOAD_REQUEST_BYTES * 2) / (256 * 1024));
    const res = await admin.request('POST', '/api/projects/food/files', {
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThan(total);
  });

  it("keeps v1's 400 for a file over 25 MB that still fits the request cap", async () => {
    const admin = client(h.app);
    await admin.login(ADMIN.email, ADMIN.password);
    const file = Buffer.alloc(25 * 1024 * 1024 + 1, 0x61);
    const res = await admin.request('POST', '/api/projects/food/files', {
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
      body: Buffer.concat([Buffer.from(multipartStart), file, Buffer.from(multipartEnd)]),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'file exceeds 25MB limit' });
  });

  it('answers 413 over a real socket, chunked, and the server stays up', async () => {
    const server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { port, host: '127.0.0.1', method: 'POST', path: '/api/login', headers: jsonHeaders },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        // The server may cut the connection once it has answered, mid-write: that is
        // the point of the test, so a reset or broken pipe is not a failure.
        const benign = new Set(['ECONNRESET', 'EPIPE']);
        req.on('socket', (socket) => socket.on('error', () => {}));
        req.on('error', (e) => {
          if (!benign.has((e as NodeJS.ErrnoException).code ?? '')) reject(e);
        });
        const chunk = Buffer.alloc(256 * 1024, 0x20);
        for (let i = 0; i < 20; i++) req.write(chunk);
        req.end();
      });
      expect(status).toBe(413);
      const ok = await fetch(`http://127.0.0.1:${port}/api/me`);
      expect(ok.status).toBe(401);
    } finally {
      (server as http.Server).closeAllConnections();
      server.close();
    }
  });
});

describe('malformed JSON', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

  const send = (body: string) =>
    post(h.app, '/api/login', { headers: { 'content-type': 'application/json' }, body });

  it.each(['{"email": ', '{bad json}', '[1,2', '{"a":1}}'])('answers 400 for %s', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'request body is not valid JSON' });
  });

  it.each(['"text"', '42', 'true', 'null'])('answers 400 for the non-object %s', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'request body must be a JSON object' });
  });

  it("still reports v1's message for a well-formed body with nothing in it", async () => {
    for (const body of ['', '{}']) {
      const res = await send(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'email and password required' });
    }
  });
});

describe('login throttle', () => {
  it('blocks an email after its failures, even for the right password, and says when to retry', async () => {
    const h = await harness({ loginThrottle: new LoginThrottle({ perEmail: 3, perIp: 100 }) });
    const c = client(h.app);
    for (let i = 0; i < 3; i++) expect((await c.login(ADMIN.email, 'wrong')).status).toBe(401);
    const blocked = await c.login(ADMIN.email, ADMIN.password);
    expect(blocked.status).toBe(429);
    expect(blocked.json).toEqual({ error: 'too many failed login attempts, try again later' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another account is unaffected.
    expect((await c.login('ghost@nowhere.test', 'x')).status).toBe(401);
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('blocks an address across many emails', async () => {
    const h = await harness({ loginThrottle: new LoginThrottle({ perEmail: 100, perIp: 4 }) });
    const c = client(h.app);
    for (let i = 0; i < 4; i++) expect((await c.login(`u${i}@x.test`, 'wrong')).status).toBe(401);
    expect((await c.login('another@x.test', 'wrong')).status).toBe(429);
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('counts only failures: a success clears the email and ordinary use is never blocked', async () => {
    const h = await harness({ loginThrottle: new LoginThrottle({ perEmail: 3, perIp: 100 }) });
    const c = client(h.app);
    for (let round = 0; round < 3; round++) {
      expect((await c.login(ADMIN.email, 'wrong')).status).toBe(401);
      expect((await c.login(ADMIN.email, 'wrong')).status).toBe(401);
      expect((await c.login(ADMIN.email, ADMIN.password)).status).toBe(200);
    }
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('lets an email back in once its failures age out of the window', () => {
    let now = 1_000_000;
    const t = new LoginThrottle({ perEmail: 2, perIp: 100, windowMs: 60_000, now: () => now });
    t.recordFailure('1.1.1.1', 'a@x');
    now += 10_000;
    t.recordFailure('1.1.1.1', 'a@x');
    expect(t.retryAfter('1.1.1.1', 'a@x')).toBe(50);
    now += 49_000;
    expect(t.retryAfter('1.1.1.1', 'a@x')).toBe(1);
    now += 1_000;
    expect(t.retryAfter('1.1.1.1', 'a@x')).toBe(0);
  });

  it('keeps its memory bounded', () => {
    const t = new LoginThrottle({ maxKeys: 50, perEmail: 1000, perIp: 1000 });
    for (let i = 0; i < 500; i++) t.recordFailure('ip' + i, 'e' + i);
    expect((t as unknown as { failures: Map<string, unknown> }).failures.size).toBeLessThanOrEqual(
      51,
    );
  });

  it('does not block the event loop while it checks passwords', async () => {
    const h = await harness({ loginThrottle: new LoginThrottle({ perEmail: 1000, perIp: 1000 }) });
    const c = client(h.app);
    // Warm the decoy hash and the thread pool first.
    await c.login(ADMIN.email, 'wrong');
    let ticks = 0;
    let running = true;
    const spin = () => {
      if (!running) return;
      ticks++;
      setImmediate(spin);
    };
    spin();
    const started = Date.now();
    await Promise.all(Array.from({ length: 4 }, () => c.login(ADMIN.email, 'wrong')));
    const elapsed = Date.now() - started;
    running = false;
    // Four bcrypt rounds take tens of milliseconds. A synchronous compare would leave
    // the loop with no turn at all in that time; an async one leaves it thousands.
    expect(elapsed).toBeGreaterThan(20);
    expect(ticks).toBeGreaterThan(50);
    expect(await bcrypt.compare('x', await bcrypt.hash('x', 4))).toBe(true);
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('answers an unknown email as slowly as a wrong password', async () => {
    const h = await harness({ loginThrottle: new LoginThrottle({ perEmail: 1000, perIp: 1000 }) });
    const c = client(h.app);
    const time = async (email: string) => {
      const t0 = performance.now();
      await c.login(email, 'wrong');
      return performance.now() - t0;
    };
    await time('ghost@x.test'); // builds the decoy hash
    const known = Math.min(...(await Promise.all([1, 2, 3].map(() => time(ADMIN.email)))));
    const unknown = Math.min(...(await Promise.all([1, 2, 3].map(() => time('ghost@x.test')))));
    expect(unknown).toBeGreaterThan(known * 0.4);
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('rejects non-string credentials with 400 instead of crashing bcrypt', async () => {
    const h = await harness();
    const c = client(h.app);
    for (const body of [
      { email: ADMIN.email, password: 12345 },
      { email: { a: 1 }, password: 'x' },
      { email: ['a'], password: ['b'] },
    ]) {
      expect((await c.call('POST', '/api/login', body)).status).toBe(400);
    }
    fs.rmSync(h.dir, { recursive: true, force: true });
  });
});

describe('event streams after a password reset', () => {
  it("closes the reset user's streams and leaves everyone else's open", async () => {
    const h = await harness();
    const admin = client(h.app);
    await admin.login(ADMIN.email, ADMIN.password);
    const created = await admin.call('POST', '/api/users', {
      email: 'sam@x.test',
      name: 'Sam',
      password: 'sam-password',
    });
    expect(created.status).toBe(201);
    const sam = client(h.app);
    await sam.login('sam@x.test', 'sam-password');

    const open = async (who: ReturnType<typeof client>) => {
      const res = await who.request('GET', '/api/events');
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read(); // the retry line, so the stream is live
      return reader;
    };
    const samStream = await open(sam);
    const adminStream = await open(admin);

    const settled = (r: ReadableStreamDefaultReader<Uint8Array>) =>
      Promise.race([
        r.read().then((x) => (x.done ? 'closed' : 'data')),
        new Promise<string>((res) => setTimeout(() => res('open'), 150)),
      ]);
    expect(await settled(samStream)).toBe('open');

    const reset = await admin.call('PATCH', `/api/users/${created.json.id}/password`, {
      password: 'brand-new-password',
    });
    expect(reset.status).toBe(200);

    expect(await settled(samStream)).toBe('closed');
    expect(await settled(adminStream)).toBe('open');
    // And the stolen cookie no longer opens a new one.
    expect((await sam.request('GET', '/api/events')).status).toBe(401);
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('closes the streams of a session on logout', async () => {
    const h = await harness();
    const c = client(h.app);
    await c.login(ADMIN.email, ADMIN.password);
    const res = await c.request('GET', '/api/events');
    const reader = res.body!.getReader();
    await reader.read();
    await c.call('POST', '/api/logout');
    expect((await reader.read()).done).toBe(true);
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('EventBus does not deliver to a stream it has closed', () => {
    const bus = new EventBus();
    const got: string[] = [];
    bus.subscribe((x) => got.push(x), { userId: 1, sessionId: 's', close: () => {} });
    bus.broadcast('a', 1);
    expect(bus.closeForUser(1)).toBe(1);
    bus.broadcast('b', 2);
    expect(got).toHaveLength(1);
  });
});

describe('security headers', () => {
  const INLINE =
    "try { document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) {}";
  let h: Harness;
  let webDir: string;
  beforeAll(async () => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-web-'));
    fs.writeFileSync(
      path.join(webDir, 'index.html'),
      `<!doctype html><html><head><script>${INLINE}</script></head><body>` +
        '<script type="module" src="/app.js"></script></body></html>',
    );
    fs.writeFileSync(path.join(webDir, 'app.js'), 'export {}');
    h = await harness({}, webDir);
  });
  afterAll(() => {
    fs.rmSync(h.dir, { recursive: true, force: true });
    fs.rmSync(webDir, { recursive: true, force: true });
  });

  const expectBase = (headers: Headers) => {
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const csp = headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("connect-src 'self'");
  };

  it('is set on the page, a script, an API success, and an error', async () => {
    for (const url of ['/', '/app.js', '/api/me', '/api/nope', '/nope']) {
      const res = await h.app.request(url);
      expectBase(res.headers);
    }
    const oversize = await post(h.app, '/api/login', {
      headers: { 'content-type': 'application/json', 'content-length': '99999999' },
      body: 'x',
    });
    expect(oversize.status).toBe(413);
    expectBase(oversize.headers);
  });

  it('allows the one inline script by hash and no other script source', async () => {
    const csp = (await h.app.request('/')).headers.get('content-security-policy') ?? '';
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    const hashes = inlineScriptHashes(fs.readFileSync(path.join(webDir, 'index.html'), 'utf8'));
    expect(hashes).toHaveLength(1);
    expect(scriptSrc).toBe(`script-src 'self' ${hashes[0]}`);
    expect(scriptSrc).not.toContain('unsafe');
    // The hash is of the script text exactly, so editing the page invalidates it.
    expect(inlineScriptHashes(`<script>${INLINE} </script>`)[0]).not.toBe(hashes[0]);
  });

  it('keeps authenticated JSON out of shared caches and sets HSTS only behind TLS', async () => {
    expect((await h.app.request('/api/me')).headers.get('cache-control')).toBe('no-store');
    expect((await h.app.request('/')).headers.get('strict-transport-security')).toBeNull();
    const tls = await h.app.request('/', { headers: { 'x-forwarded-proto': 'https' } });
    expect(tls.headers.get('strict-transport-security')).toMatch(/^max-age=\d+/);
  });
});

describe('request validation on the shared schemas', () => {
  let h: Harness;
  let c: ReturnType<typeof client>;
  let cardUrl = '';
  beforeAll(async () => {
    h = await harness();
    c = client(h.app);
    await c.login(ADMIN.email, ADMIN.password);
    const retro = await c.call('POST', '/api/projects/food/boards/eng/retros', { name: 'R' });
    const card = await c.call('POST', `/api/retros/${retro.json.id}/cards`, {
      column: 'well',
      body: 'ok',
    });
    cardUrl = `/api/retros/${retro.json.id}/cards/${card.json.id}`;
    await c.call('POST', '/api/tickets', {
      project_slug: 'food',
      board_slug: 'eng',
      title: 'seed',
      type: 'task',
    });
  });
  afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

  const cases: [string, string, string, unknown][] = [
    ['PATCH', 'CARD', 'a retro card body as a number', { body: 42 }],
    [
      'POST',
      '/api/tickets',
      'title as an object',
      { project_slug: 'food', board_slug: 'eng', title: { a: 1 }, type: 'task' },
    ],
    [
      'POST',
      '/api/tickets',
      'points as a string',
      { project_slug: 'food', board_slug: 'eng', title: 't', type: 'task', points: 'many' },
    ],
    ['PATCH', '/api/tickets/FOOD-ENG-1', 'description as a number', { description: 42 }],
    ['PATCH', '/api/tickets/FOOD-ENG-1', 'assignee as an array', { assignee: ['a'] }],
    ['POST', '/api/tickets/FOOD-ENG-1/comments', 'comment body as an object', { body: { x: 1 } }],
    [
      'POST',
      '/api/tickets/FOOD-ENG-1/links',
      'link title as an array',
      { title: ['t'], url: 'https://a.test' },
    ],
    ['PATCH', '/api/tickets/FOOD-ENG-1/dod', 'dod item as a number', { item: 5 }],
    ['POST', '/api/projects/food/docs', 'doc kind as an object', { title: 't', kind: { a: 1 } }],
    ['POST', '/api/projects/food/boards/eng/sprints', 'sprint name as a number', { name: 5 }],
    [
      'POST',
      '/api/projects/food/boards/eng/sprints',
      'a sprint date that is not a date',
      { name: 's', start_date: 'soon' },
    ],
    ['POST', '/api/projects/food/boards/eng/retros', 'retro name as an object', { name: { a: 1 } }],
    [
      'POST',
      '/api/users',
      'a numeric user name',
      { email: 'q@x.test', name: 7, password: 'secret1' },
    ],
    ['PATCH', '/api/users/1/password', 'a numeric password', { password: 1234567 }],
    [
      'PATCH',
      '/api/projects/food/boards/eng/settings',
      'wip limits as strings',
      { wip_limits: { 'In Progress': 'two' } },
    ],
    [
      'POST',
      '/api/github/pr-opened',
      'webhook repo as an object',
      { branch: 'FOOD-ENG-1', repo: { a: 1 } },
    ],
  ];

  it.each(cases)('%s %s with %s is a 400, not a 500', async (method, rawUrl, _what, body) => {
    const url = rawUrl === 'CARD' ? cardUrl : rawUrl;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (url.includes('/github/')) headers['x-pm-token'] = 'tok';
    const res = await c.request(method, url, { headers, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/\S/);
    expect(error).not.toMatch(/internal/);
  });

  it('names the field that is wrong', async () => {
    const res = await c.call('PATCH', '/api/tickets/FOOD-ENG-1', { description: 42 });
    expect(res.json.error).toMatch(/^invalid description: /);
  });

  it("keeps v1's exact messages where the service checks come first", async () => {
    const msg = async (method: string, url: string, body: unknown) =>
      (await c.call(method, url, body)).json.error;
    expect(
      await msg('POST', '/api/tickets', { project_slug: 'food', board_slug: 'eng', type: 'task' }),
    ).toBe('title required');
    expect(
      await msg('POST', '/api/tickets', {
        project_slug: 'food',
        board_slug: 'eng',
        title: 't',
        type: 'nope',
      }),
    ).toBe('type must be one of: task, bug');
    expect(
      await msg('POST', '/api/tickets', {
        project_slug: 'food',
        board_slug: 'eng',
        title: 't',
        type: 'task',
        priority: 'asap',
      }),
    ).toBe('priority must be one of: urgent, high, medium, low');
    expect(await msg('PATCH', '/api/tickets/FOOD-ENG-1', { status: 'Nowhere' })).toBe(
      'status must be one of: Backlog, In Progress, Code Review, QA, Done',
    );
    expect(await msg('PATCH', '/api/tickets/FOOD-ENG-1', { nothing: 1 })).toBe(
      'no patchable fields provided',
    );
    expect(await msg('POST', '/api/tickets/FOOD-ENG-1/comments', {})).toBe('body required');
    expect(await msg('POST', '/api/projects/food/boards/eng/sprints', {})).toBe('name required');
    expect(await msg('POST', '/api/projects/food/docs', { title: 't' })).toBe(
      'title and kind required',
    );
    expect(await msg('POST', '/api/users', { email: 'a' })).toBe('email, name, password required');
    expect(await msg('PATCH', '/api/users/1/password', { password: 'abc' })).toBe(
      'password must be at least 6 characters',
    );
  });

  it('still accepts everything v1 accepted: truthy flags, nulls, empty dates', async () => {
    const ok = await c.call('PATCH', '/api/tickets/FOOD-ENG-1', {
      blocked: 1,
      assignee: null,
      due_date: '',
      points: null,
      acceptance_criteria: ['a'],
    });
    expect(ok.status).toBe(200);
    expect(
      (
        await c.call('POST', '/api/projects/food/boards/eng/sprints', {
          name: 's',
          start_date: '',
          end_date: null,
        })
      ).status,
    ).toBe(201);
  });
});

describe('GitHub webhooks follow the same transition rules as a manual move', () => {
  it('refuses to skip a waterfall phase from CI, as it does for a person, and says so', async () => {
    const h = await harness();
    const c = client(h.app);
    await c.login(ADMIN.email, ADMIN.password);
    const created = await c.call('POST', '/api/tickets', {
      project_slug: 'acme',
      board_slug: 'eng',
      title: 'phase',
      type: 'task',
    });
    const key = created.json.key as string;
    const hook = (url: string, body: unknown) =>
      h.app.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pm-token': 'tok' },
        body: JSON.stringify(body),
      });

    // The same jump by hand is a 409.
    const manual = await c.call('PATCH', `/api/tickets/${key}`, { status: 'Deployed' });
    expect(manual.status).toBe(409);

    const res = await hook('/api/github/deploy', { branch: key, environment: 'production' });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      matched: string[];
      skipped?: { key: string; reason: string }[];
    };
    expect(result.matched).toEqual([]);
    expect(result.skipped).toEqual([{ key, reason: manual.json.error as string }]);
    expect((await c.call('GET', `/api/tickets/${key}`)).json.status).toBe('Requirements');

    const comments = (await (await c.request('GET', `/api/tickets/${key}/comments`)).json()) as {
      body: string;
    }[];
    expect(comments.at(-1)!.body).toMatch(
      /Deployed to production\. Not moved: Waterfall boards are sequential/,
    );
    const links = (await (
      await c.request('GET', `/api/tickets/${key}/github`)
    ).json()) as unknown[];
    expect(links).toHaveLength(1);

    // One phase at a time is allowed, for CI as for a person.
    await c
      .call('PATCH', `/api/tickets/${key}`, { status: 'Testing' })
      .then((r) => expect(r.status).toBe(409));
    for (const status of ['Design', 'Implementation', 'Testing']) {
      expect((await c.call('PATCH', `/api/tickets/${key}`, { status })).status).toBe(200);
    }
    const ok = await hook('/api/github/deploy', { branch: key, environment: 'production' });
    expect(((await ok.json()) as { matched: string[] }).matched).toEqual([key]);
    expect((await c.call('GET', `/api/tickets/${key}`)).json.status).toBe('Deployed');
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('still moves a scrum ticket anywhere, as before', async () => {
    const h = await harness();
    const c = client(h.app);
    await c.login(ADMIN.email, ADMIN.password);
    const key = (
      await c.call('POST', '/api/tickets', {
        project_slug: 'food',
        board_slug: 'eng',
        title: 'x',
        type: 'task',
      })
    ).json.key as string;
    const res = await h.app.request('/api/github/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pm-token': 'tok' },
      body: JSON.stringify({ tag: 'v1', changelog: key }),
    });
    expect(((await res.json()) as { matched: string[] }).matched).toEqual([key]);
    expect((await c.call('GET', `/api/tickets/${key}`)).json.status).toBe('Done');
    fs.rmSync(h.dir, { recursive: true, force: true });
  });
});

describe('static client files', () => {
  let h: Harness;
  let webDir: string;
  beforeAll(async () => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-static-'));
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html>');
    fs.mkdirSync(path.join(webDir, 'assets'));
    fs.writeFileSync(path.join(webDir, 'assets/page-abc123.js'), 'export default 1');
    fs.writeFileSync(path.join(webDir, 'secret.txt'), 'no');
    h = await harness({}, webDir);
  });
  afterAll(() => {
    fs.rmSync(h.dir, { recursive: true, force: true });
    fs.rmSync(webDir, { recursive: true, force: true });
  });

  it('serves hashed assets as immutable JavaScript', async () => {
    const res = await h.app.request('/assets/page-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('export default 1');
  });

  it.each([
    '/assets/missing.js',
    '/assets/..%2Fsecret.txt',
    '/assets/%2e%2e/secret.txt',
    '/assets/%00.js',
    '/assets/%E0%A4%A',
    '/vendor/%E0%A4%A',
  ])('answers 404, never a file outside the directory or a 500, for %s', async (url) => {
    const res = await h.app.request(url);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});
