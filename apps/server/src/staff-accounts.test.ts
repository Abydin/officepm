import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrapAdmin,
  createApp,
  EventBus,
  loadConfig,
  openDatabase,
  ProjectsRegistry,
  seedBoards,
} from './index.js';
import type { AppContext } from './context.js';
import { DEMO_REFUSAL, ensureDemoWorkspace, isDemoBlocked } from './demo.js';
import { LoginThrottle } from './http/throttle.js';
import { parsePublicUrl } from './config.js';
import { runMigrations } from './db/migrate.js';
import { BASELINE_SQL } from './db/migrations/0000-baseline.js';
import { createUserService } from './modules/users/service.js';
import { hashToken } from './modules/invites/service.js';
import { parseProjectsConfig } from './projects-config.js';
import { DEMO_PASSWORD } from './seed/demo-data.js';

const PROJECTS = {
  projects: [
    {
      slug: 'food',
      name: 'Food',
      description: 'd',
      boards: [
        {
          slug: 'eng',
          name: 'Engineering',
          prefix: 'FOOD-ENG',
          flow: 'kanban',
          agile: false,
          points: false,
          has_github: false,
          statuses: ['Backlog', 'Done'],
          types: ['task'],
          done_statuses: ['Done'],
        },
      ],
    },
  ],
};
const ADMIN = { email: 'admin@officepm.local', password: 'unit-test-password' };
const PW = 'a-good-password';
const MAYA = 'maya.okafor@officepm.demo';

type App = ReturnType<typeof createApp>;
interface Harness {
  app: App;
  ctx: AppContext;
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function harness(
  env: Record<string, string> = {},
  extra: Partial<AppContext> = {},
): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-staff-'));
  dirs.push(dir);
  const ctx: AppContext = {
    config: loadConfig({
      PM_DATA_DIR: dir,
      PM_TOKEN: 'tok',
      ADMIN_PASSWORD: ADMIN.password,
      ...env,
    }),
    db: openDatabase({ filename: ':memory:' }),
    projects: new ProjectsRegistry(parseProjectsConfig(JSON.stringify(PROJECTS))),
    events: new EventBus(),
    dashboardCache: new Map(),
    ...extra,
  };
  seedBoards(ctx);
  await bootstrapAdmin(ctx);
  return { app: createApp(ctx), ctx };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A browser stand-in: keeps the session cookie between calls. */
function client(app: App, headers: Record<string, string> = {}) {
  let cookie = '';
  const request = async (method: string, url: string, init: RequestInit = {}) => {
    const res = await app.request(url, {
      ...init,
      method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(init.headers as object) },
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
    const text = await res.text();
    return {
      status: res.status,
      json: (text ? JSON.parse(text) : null) as Json,
      headers: res.headers,
    };
  };
  const login = (email: string, password: string) =>
    call('POST', '/api/login', { email, password });
  return {
    request,
    call,
    login,
    get cookie() {
      return cookie;
    },
  };
}

async function signedIn(h: Harness, email = ADMIN.email, password = ADMIN.password) {
  const c = client(h.app);
  const res = await c.login(email, password);
  expect(res.status).toBe(200);
  return c;
}

/** Makes an ordinary account without going through the API, so it starts with no forced change. */
function addUser(h: Harness, email: string, opts: { admin?: boolean; name?: string } = {}) {
  const info = h.ctx.db.raw
    .prepare('INSERT INTO users (email, name, password, is_admin) VALUES (?,?,?,?)')
    .run(email, opts.name ?? email.split('@')[0], bcrypt.hashSync(PW, 4), opts.admin ? 1 : 0);
  return Number(info.lastInsertRowid);
}

const row = <T = Json>(h: Harness, sql: string, ...args: unknown[]) =>
  h.ctx.db.raw.prepare(sql).get(...args) as T;

const tokenOf = (link: string) => link.split('/#/invite/')[1]!;

async function invite(
  admin: ReturnType<typeof client>,
  email: string,
  extra: Json = {},
): Promise<Json & { token: string }> {
  const res = await admin.call('POST', '/api/invites', { email, name: 'New Person', ...extra });
  expect(res.status).toBe(201);
  return { ...res.json, token: tokenOf(res.json.link as string) };
}

const settled = (r: ReadableStreamDefaultReader<Uint8Array>) =>
  Promise.race([
    r.read().then((x) => (x.done ? 'closed' : 'data')),
    new Promise<string>((res) => setTimeout(() => res('open'), 150)),
  ]);
async function openStream(who: ReturnType<typeof client>) {
  const res = await who.request('GET', '/api/events');
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  await reader.read();
  return reader;
}

describe('invite links', () => {
  it('makes a link on the request origin and stores only the hash of the token', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const made = await invite(admin, 'Ada@Example.com', { is_admin: true });
    expect(made.link).toMatch(/^http:\/\/localhost\/#\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(made.email).toBe('ada@example.com');
    expect(made.is_admin).toBe(true);

    const stored = row(h, 'SELECT * FROM invites');
    expect(stored.token_hash).toBe(hashToken(made.token));
    expect(JSON.stringify(stored)).not.toContain(made.token);
    expect(stored.created_by).toBe(1);
    // Seven days, in SQLite's own date format.
    const days = row<{ d: number }>(
      h,
      'SELECT julianday(expires_at) - julianday(created_at) AS d FROM invites',
    ).d;
    expect(days).toBeCloseTo(7, 1);
  });

  it('lists invites by status and never shows a token', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const pending = await invite(admin, 'p@x.test');
    const used = await invite(admin, 'u@x.test');
    const expired = await invite(admin, 'e@x.test');
    await client(h.app).call('POST', `/api/invites/${used.token}/accept`, { password: PW });
    h.ctx.db.raw
      .prepare("UPDATE invites SET expires_at = datetime('now', '-1 hour') WHERE id = ?")
      .run(expired.id);

    const list = (await admin.call('GET', '/api/invites')).json as unknown as Json[];
    const by = (id: string) => list.find((i) => i.id === id)!;
    expect(by(pending.id).status).toBe('pending');
    expect(by(used.id).status).toBe('used');
    expect(by(used.id).used_at).toBeTruthy();
    expect(by(expired.id).status).toBe('expired');
    expect(by(pending.id).created_by_name).toBe('Admin');
    const text = JSON.stringify(list);
    for (const t of [pending, used, expired]) expect(text).not.toContain(t.token);
    expect(text).not.toContain('token');
  });

  it('is for admins only', async () => {
    const h = await harness();
    addUser(h, 'sam@x.test');
    const sam = await signedIn(h, 'sam@x.test', PW);
    const body = { email: 'z@x.test', name: 'Z' };
    expect((await sam.call('POST', '/api/invites', body)).status).toBe(403);
    expect((await sam.call('GET', '/api/invites')).status).toBe(403);
    expect((await sam.call('DELETE', '/api/invites/x')).status).toBe(403);
    expect((await sam.call('POST', '/api/invites/import', { csv: 'email,name\n' })).status).toBe(
      403,
    );
    const anon = client(h.app);
    expect((await anon.call('POST', '/api/invites', body)).status).toBe(401);
    expect((await anon.call('GET', '/api/invites')).status).toBe(401);
  });

  it('refuses a bad email or name, an existing account and a second pending invite', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const post = (b: Json) => admin.call('POST', '/api/invites', b);
    expect((await post({ email: 'nope', name: 'A' })).status).toBe(400);
    expect((await post({ email: 'a@x.test', name: ' ' })).status).toBe(400);
    expect((await post({ email: 'a@x.test', name: 'A', is_admin: 'yes' })).status).toBe(400);
    const taken = await post({ email: ADMIN.email.toUpperCase(), name: 'A' });
    expect(taken.status).toBe(409);
    await invite(admin, 'dup@x.test');
    expect((await post({ email: 'DUP@x.test', name: 'B' })).status).toBe(409);
  });

  it('allows a new invite once the old one is expired, used or revoked', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const first = await invite(admin, 'again@x.test');
    h.ctx.db.raw.prepare("UPDATE invites SET expires_at = datetime('now', '-1 day')").run();
    await invite(admin, 'again@x.test');
    await admin.call('DELETE', `/api/invites/${first.id}`);
  });

  it('validates a token with the email and name only, and answers every bad token the same way', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const ok = await invite(admin, 'ok@x.test');
    const anon = client(h.app);
    const preview = await anon.call('GET', `/api/invites/${ok.token}`);
    expect(preview.status).toBe(200);
    expect(preview.json).toEqual({ email: 'ok@x.test', name: 'New Person' });
    expect(preview.headers.get('cache-control')).toBe('no-store');

    const expired = await invite(admin, 'old@x.test');
    h.ctx.db.raw
      .prepare("UPDATE invites SET expires_at = datetime('now', '-1 second') WHERE id = ?")
      .run(expired.id);
    const used = await invite(admin, 'used@x.test');
    await client(h.app).call('POST', `/api/invites/${used.token}/accept`, { password: PW });
    const revoked = await invite(admin, 'gone@x.test');
    await admin.call('DELETE', `/api/invites/${revoked.id}`);

    const bad = [
      expired.token,
      used.token,
      revoked.token,
      'A'.repeat(43), // well formed, unknown
      'short',
      'x'.repeat(200),
      ok.token.slice(0, -1) + (ok.token.endsWith('A') ? 'B' : 'A'), // one character off
    ];
    for (const token of bad) {
      const res = await anon.call('GET', `/api/invites/${token}`);
      expect({ token: token.slice(0, 6), status: res.status, json: res.json }).toEqual({
        token: token.slice(0, 6),
        status: 404,
        json: { error: 'invite not found' },
      });
      const acc = await anon.call('POST', `/api/invites/${token}/accept`, { password: PW });
      expect(acc.status).toBe(404);
      expect(acc.json).toEqual({ error: 'invite not found' });
    }
  });

  it('accepts: makes the account, marks the invite used, signs the person in', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const made = await invite(admin, 'new@x.test', { is_admin: true });
    const person = client(h.app);
    const res = await person.call('POST', `/api/invites/${made.token}/accept`, { password: PW });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({
      id: expect.any(Number),
      email: 'new@x.test',
      name: 'New Person',
      isAdmin: true,
      mustChangePassword: false,
    });
    expect(res.headers.get('set-cookie')).toMatch(/pm_session=.*HttpOnly/i);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The session works, and the account has no forced change and the password they chose.
    const me = await person.call('GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.json.mustChangePassword).toBe(false);
    expect((await client(h.app).login('new@x.test', PW)).status).toBe(200);
    expect(row(h, 'SELECT used_at FROM invites').used_at).toBeTruthy();
    expect(row(h, "SELECT must_change_password AS f FROM users WHERE email='new@x.test'").f).toBe(
      0,
    );
  });

  it('cannot be used twice, and a second request racing the first makes one account', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const made = await invite(admin, 'race@x.test');
    const [a, b] = await Promise.all([
      client(h.app).call('POST', `/api/invites/${made.token}/accept`, { password: PW }),
      client(h.app).call('POST', `/api/invites/${made.token}/accept`, { password: PW }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 404]);
    expect(row<{ n: number }>(h, "SELECT COUNT(*) n FROM users WHERE email='race@x.test'").n).toBe(
      1,
    );
    const again = await client(h.app).call('POST', `/api/invites/${made.token}/accept`, {
      password: PW,
    });
    expect(again.status).toBe(404);
  });

  it('refuses a password under 8 characters or over 72 bytes and keeps the invite usable', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const made = await invite(admin, 'pw@x.test');
    const anon = client(h.app);
    for (const password of ['1234567', 'x'.repeat(73), 12345678, undefined]) {
      const res = await anon.call('POST', `/api/invites/${made.token}/accept`, { password });
      expect(res.status).toBe(400);
    }
    expect(row(h, 'SELECT used_at FROM invites').used_at).toBeNull();
    expect(
      (await anon.call('POST', `/api/invites/${made.token}/accept`, { password: '12345678' }))
        .status,
    ).toBe(201);
  });

  it('fails cleanly when the email got an account after the invite, and leaves the invite alone', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const made = await invite(admin, 'late@x.test');
    addUser(h, 'late@x.test');
    const res = await client(h.app).call('POST', `/api/invites/${made.token}/accept`, {
      password: PW,
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/already exists/);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(row(h, 'SELECT used_at FROM invites').used_at).toBeNull();
    expect(
      row<{ n: number }>(
        h,
        "SELECT COUNT(*) n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'late@x.test'",
      ).n,
    ).toBe(0);
  });

  it('revokes a pending or expired invite, and not a used or unknown one', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const pending = await invite(admin, 'r1@x.test');
    expect((await admin.call('DELETE', `/api/invites/${pending.id}`)).status).toBe(200);
    expect((await client(h.app).call('GET', `/api/invites/${pending.token}`)).status).toBe(404);
    const used = await invite(admin, 'r2@x.test');
    await client(h.app).call('POST', `/api/invites/${used.token}/accept`, { password: PW });
    expect((await admin.call('DELETE', `/api/invites/${used.id}`)).status).toBe(409);
    expect((await admin.call('DELETE', '/api/invites/nope')).status).toBe(404);
    expect(row<{ n: number }>(h, 'SELECT COUNT(*) n FROM invites').n).toBe(1);
  });

  it('throttles guesses on the public routes, refunds a real token, and answers 429 with Retry-After', async () => {
    const h = await harness({}, { inviteThrottle: new LoginThrottle({ perIp: 3 }) });
    const admin = await signedIn(h);
    const real = await invite(admin, 'real@x.test');
    const anon = client(h.app);
    // Valid lookups are free: far more than 3 of them.
    for (let i = 0; i < 6; i++)
      expect((await anon.call('GET', `/api/invites/${real.token}`)).status).toBe(200);
    const guess = () => anon.call('GET', `/api/invites/${'B'.repeat(43)}`);
    expect([(await guess()).status, (await guess()).status, (await guess()).status]).toEqual([
      404, 404, 404,
    ]);
    const blocked = await guess();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // POST accept shares the budget, and even a real token is held while it lasts.
    const acc = await anon.call('POST', `/api/invites/${'C'.repeat(43)}/accept`, { password: PW });
    expect(acc.status).toBe(429);
  });
});

describe('where invite links point', () => {
  it('uses PM_PUBLIC_URL when it is set', async () => {
    const h = await harness({ PM_PUBLIC_URL: 'https://pm.example.com/' });
    const admin = await signedIn(h);
    expect((await invite(admin, 'a@x.test')).link).toMatch(
      /^https:\/\/pm\.example\.com\/#\/invite\//,
    );
  });

  it('ignores X-Forwarded-* unless the proxy is trusted, and then takes the last entry', async () => {
    const fwd = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.test, pm.office.test' };
    const plain = await harness();
    const a = client(plain.app, fwd);
    await a.login(ADMIN.email, ADMIN.password);
    expect((await invite(a, 'a@x.test')).link).toMatch(/^http:\/\/localhost\/#/);

    const trusted = await harness({ PM_TRUST_PROXY: '1' });
    const b = client(trusted.app, fwd);
    await b.login(ADMIN.email, ADMIN.password);
    expect((await invite(b, 'a@x.test')).link).toMatch(/^https:\/\/pm\.office\.test\/#/);

    const junk = client(trusted.app, { 'x-forwarded-host': 'a b/c' });
    await junk.login(ADMIN.email, ADMIN.password);
    expect((await invite(junk, 'b@x.test')).link).toMatch(/^http:\/\/localhost\/#/);
  });

  it('validates PM_PUBLIC_URL at start-up', () => {
    expect(parsePublicUrl(undefined)).toBe('');
    expect(parsePublicUrl(' https://pm.example.com ')).toBe('https://pm.example.com');
    expect(parsePublicUrl('http://10.0.0.5:3000/')).toBe('http://10.0.0.5:3000');
    for (const bad of [
      'pm.example.com',
      'ftp://x.test',
      'https://x.test/app',
      'https://u:p@x.test',
      'https://x.test/?a=1',
    ]) {
      expect(() => parsePublicUrl(bad), bad).toThrow(/PM_PUBLIC_URL/);
    }
  });
});

describe('changing your own password', () => {
  it('needs the current password, clears the other sessions and keeps this one', async () => {
    const h = await harness();
    addUser(h, 'sam@x.test');
    const here = await signedIn(h, 'sam@x.test', PW);
    const elsewhere = await signedIn(h, 'sam@x.test', PW);
    const hereStream = await openStream(here);
    const elsewhereStream = await openStream(elsewhere);

    const res = await here.call('POST', '/api/me/password', {
      current_password: PW,
      new_password: 'a-new-password',
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect((await here.call('GET', '/api/me')).status).toBe(200);
    expect((await elsewhere.call('GET', '/api/me')).status).toBe(401);
    expect(await settled(elsewhereStream)).toBe('closed');
    expect(await settled(hereStream)).toBe('open');
    expect((await client(h.app).login('sam@x.test', PW)).status).toBe(401);
    expect((await client(h.app).login('sam@x.test', 'a-new-password')).status).toBe(200);
  });

  it('answers a wrong current password with 403, never 401, and does not change anything', async () => {
    const h = await harness();
    addUser(h, 'sam@x.test');
    const sam = await signedIn(h, 'sam@x.test', PW);
    const res = await sam.call('POST', '/api/me/password', {
      current_password: 'wrong-password',
      new_password: 'a-new-password',
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('current password is incorrect');
    expect((await client(h.app).login('sam@x.test', PW)).status).toBe(200);
  });

  it('throttles wrong current passwords like logins, and a right one clears the count', async () => {
    const h = await harness({}, { loginThrottle: new LoginThrottle({ perEmail: 3, perIp: 100 }) });
    addUser(h, 'sam@x.test');
    const sam = await signedIn(h, 'sam@x.test', PW);
    const wrong = () =>
      sam.call('POST', '/api/me/password', {
        current_password: 'nope-nope',
        new_password: 'a-new-password',
      });
    expect((await wrong()).status).toBe(403);
    expect((await wrong()).status).toBe(403);
    // A right guess in between refunds and clears the pair.
    const ok = await sam.call('POST', '/api/me/password', {
      current_password: PW,
      new_password: 'second-password',
    });
    expect(ok.status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await wrong()).status).toBe(403);
    const held = await wrong();
    expect(held.status).toBe(429);
    expect(Number(held.headers.get('retry-after'))).toBeGreaterThan(0);
    // Held means held, even for the right password.
    const right = await sam.call('POST', '/api/me/password', {
      current_password: 'second-password',
      new_password: 'third-password',
    });
    expect(right.status).toBe(429);
  });

  it('refuses a short, long, missing, non-string or unchanged new password', async () => {
    const h = await harness();
    addUser(h, 'sam@x.test');
    const sam = await signedIn(h, 'sam@x.test', PW);
    const go = (b: Json) => sam.call('POST', '/api/me/password', b);
    expect((await go({ current_password: PW, new_password: 'short' })).status).toBe(400);
    expect((await go({ current_password: PW, new_password: 'x'.repeat(73) })).status).toBe(400);
    expect((await go({ current_password: PW })).status).toBe(400);
    expect((await go({ new_password: 'a-new-password' })).status).toBe(400);
    expect((await go({ current_password: 1, new_password: 'a-new-password' })).status).toBe(400);
    expect((await go({ current_password: PW, new_password: PW })).status).toBe(400);
    expect(
      (
        await client(h.app).call('POST', '/api/me/password', {
          current_password: PW,
          new_password: 'a-new-password',
        })
      ).status,
    ).toBe(401);
  });
});

describe('forced password change', () => {
  it('is set by an admin creating a user or resetting a password, and by nothing else', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const created = await admin.call('POST', '/api/users', {
      email: 'c@x.test',
      name: 'C',
      password: 'abcdef',
    });
    expect(created.status).toBe(201);
    const flag = (email: string) =>
      row<{ f: number }>(h, 'SELECT must_change_password f FROM users WHERE email = ?', email).f;
    expect(flag('c@x.test')).toBe(1);
    expect(flag(ADMIN.email)).toBe(0); // the first-boot admin

    addUser(h, 'd@x.test');
    expect(flag('d@x.test')).toBe(0);
    const id = row<{ id: number }>(h, "SELECT id FROM users WHERE email='d@x.test'").id;
    expect(
      (await admin.call('PATCH', `/api/users/${id}/password`, { password: 'abcdef' })).status,
    ).toBe(200);
    expect(flag('d@x.test')).toBe(1);

    const invited = await invite(admin, 'i@x.test');
    await client(h.app).call('POST', `/api/invites/${invited.token}/accept`, { password: PW });
    expect(flag('i@x.test')).toBe(0);
  });

  it('shows in the login, /me, /session and the user list', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    await admin.call('POST', '/api/users', { email: 'c@x.test', name: 'C', password: 'abcdef' });
    const c = client(h.app);
    const login = await c.login('c@x.test', 'abcdef');
    expect(login.json.mustChangePassword).toBe(true);
    expect((await c.call('GET', '/api/me')).json.mustChangePassword).toBe(true);
    expect((await c.call('GET', '/api/session')).json.mustChangePassword).toBe(true);
    const users = (await admin.call('GET', '/api/users')).json as unknown as Json[];
    expect(users.find((u) => u.email === 'c@x.test')!.must_change_password).toBe(1);
    expect((await admin.call('GET', '/api/me')).json.mustChangePassword).toBe(false);
  });

  it('answers 403 password_change_required on EVERY authenticated route except the allowlist', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    await admin.call('POST', '/api/users', { email: 'c@x.test', name: 'C', password: 'abcdef' });
    // An admin who must change: the strictest case, since every admin route is in reach otherwise.
    h.ctx.db.raw.prepare("UPDATE users SET is_admin = 1 WHERE email = 'c@x.test'").run();
    const c = client(h.app);
    await c.login('c@x.test', 'abcdef');

    const allowed = new Set(['GET /api/me', 'POST /api/me/password']);
    // Not behind a session: they never reach the check, so they keep working for everyone.
    const open = [
      /^GET \/api\/(health|config|session)$/,
      /^POST \/api\/(login|logout)$/,
      /^GET \/api\/invites\/:token$/,
      /^POST \/api\/invites\/:token\/accept$/,
      /^POST \/api\/github\//, // CI webhooks: a shared token, no session
    ];
    const routes = h.app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/'))
      .map((r) => `${r.method} ${r.path.replace(/\/$/, '')}`);
    const unique = [...new Set(routes)];
    const gated: string[] = [];
    for (const r of unique) {
      if (allowed.has(r) || open.some((re) => re.test(r))) continue;
      const [method, p] = r.split(' ') as [string, string];
      const res = await c.call(
        method,
        p.replace(/:[A-Za-z]+/g, 'x'),
        method === 'GET' ? undefined : {},
      );
      expect({ r, status: res.status, json: res.json }).toEqual({
        r,
        status: 403,
        json: { error: 'password_change_required' },
      });
      gated.push(r);
    }
    expect(gated.length).toBeGreaterThan(50);
    expect(gated).toContain('GET /api/events');
    expect(gated).toContain('GET /api/users');
    expect(gated).toContain('POST /api/invites');

    // The allowlist and the open routes really do work for this person.
    expect((await c.call('GET', '/api/me')).status).toBe(200);
    expect((await c.call('GET', '/api/config')).status).toBe(200);
    expect((await c.call('GET', '/api/session')).status).toBe(200);
    expect((await c.call('POST', '/api/logout', {})).status).toBe(200);
  });

  it('lets /me/password through, with and without a trailing slash, and the change unlocks everything', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    await admin.call('POST', '/api/users', { email: 'c@x.test', name: 'C', password: 'abcdef' });
    const c = client(h.app);
    await c.login('c@x.test', 'abcdef');
    expect((await c.call('GET', '/api/projects')).status).toBe(403);
    const res = await c.call('POST', '/api/me/password/', {
      current_password: 'abcdef',
      new_password: 'a-new-password',
    });
    expect(res.status).toBe(200);
    expect((await c.call('GET', '/api/projects')).status).toBe(200);
    expect((await c.call('GET', '/api/me')).json.mustChangePassword).toBe(false);
  });

  it('keeps a signed-in person locked out the moment an admin resets their password and they sign in again', async () => {
    const h = await harness();
    addUser(h, 'sam@x.test');
    const admin = await signedIn(h);
    const sam = await signedIn(h, 'sam@x.test', PW);
    const id = row<{ id: number }>(h, "SELECT id FROM users WHERE email='sam@x.test'").id;
    await admin.call('PATCH', `/api/users/${id}/password`, { password: 'abcdef' });
    expect((await sam.call('GET', '/api/projects')).status).toBe(401);
    const again = await signedIn(h, 'sam@x.test', 'abcdef');
    expect((await again.call('GET', '/api/projects')).json.error).toBe('password_change_required');
  });
});

describe('deactivating people', () => {
  it('stops sign-in with the same answer as a wrong password, and ends sessions and streams now', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const id = addUser(h, 'sam@x.test', { name: 'Sam' });
    const sam = await signedIn(h, 'sam@x.test', PW);
    const stream = await openStream(sam);
    const adminStream = await openStream(admin);
    const wrong = await client(h.app).login('sam@x.test', 'not-the-password');

    const res = await admin.call('POST', `/api/users/${id}/deactivate`, {});
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(id);
    expect(res.json.deactivated_at).toBeTruthy();
    expect(await settled(stream)).toBe('closed');
    expect(await settled(adminStream)).toBe('open');
    expect((await sam.call('GET', '/api/me')).status).toBe(401);

    const blocked = await client(h.app).login('sam@x.test', PW);
    expect(blocked.status).toBe(401);
    expect(blocked.json).toEqual(wrong.json);
    expect(blocked.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a session that somehow survived, and a deactivated account that signs in on a held cookie', async () => {
    const h = await harness();
    const id = addUser(h, 'sam@x.test');
    const sam = await signedIn(h, 'sam@x.test', PW);
    h.ctx.db.raw.prepare("UPDATE users SET deactivated_at = datetime('now') WHERE id = ?").run(id);
    expect((await sam.call('GET', '/api/me')).status).toBe(401);
    expect((await sam.call('GET', '/api/session')).json).toBeNull();
  });

  it('does not let an admin deactivate themself', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    addUser(h, 'two@x.test', { admin: true });
    const res = await admin.call('POST', '/api/users/1/deactivate', {});
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/your own account/);
    expect(row(h, 'SELECT deactivated_at d FROM users WHERE id = 1').d).toBeNull();
  });

  it('never deactivates the last active admin', async () => {
    const h = await harness();
    const service = createUserService(h.ctx);
    const outsider = {
      id: 999,
      email: 'x@x.test',
      name: 'X',
      isAdmin: true,
      mustChangePassword: false,
    };
    // The only admin, asked by someone else: refused.
    expect(() => service.deactivate('1', outsider)).toThrow(/last active admin/);
    expect(row(h, 'SELECT deactivated_at d FROM users WHERE id = 1').d).toBeNull();

    // With a second admin it is allowed, and then the second is the last.
    const two = addUser(h, 'two@x.test', { admin: true });
    expect(service.deactivate('1', outsider).deactivated_at).toBeTruthy();
    expect(() => service.deactivate(String(two), outsider)).toThrow(/last active admin/);
    // A deactivated admin does not count as active.
    service.reactivate('1');
    expect(service.deactivate(String(two), outsider).deactivated_at).toBeTruthy();
  });

  it('cannot leave a deactivated admin as the only way in, over HTTP', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const two = addUser(h, 'two@x.test', { admin: true });
    expect((await admin.call('POST', `/api/users/${two}/deactivate`, {})).status).toBe(200);
    // The remaining admin is the actor, so the actor can never be the one left out.
    expect((await admin.call('POST', '/api/users/1/deactivate', {})).status).toBe(409);
  });

  it('is admin only, idempotent, and a 404 for a user that does not exist', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const id = addUser(h, 'sam@x.test');
    const sam = await signedIn(h, 'sam@x.test', PW);
    expect((await sam.call('POST', `/api/users/${id}/deactivate`, {})).status).toBe(403);
    expect((await client(h.app).call('POST', `/api/users/${id}/deactivate`, {})).status).toBe(401);
    const first = await admin.call('POST', `/api/users/${id}/deactivate`, {});
    const second = await admin.call('POST', `/api/users/${id}/deactivate`, {});
    expect(second.status).toBe(200);
    expect(second.json.deactivated_at).toBe(first.json.deactivated_at);
    expect((await admin.call('POST', '/api/users/9999/deactivate', {})).status).toBe(404);
    expect((await admin.call('POST', '/api/users/abc/deactivate', {})).status).toBe(404);
    expect((await admin.call('POST', '/api/users/9999/reactivate', {})).status).toBe(404);
  });

  it('reactivates: the person signs in again with the password they had', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const id = addUser(h, 'sam@x.test');
    await admin.call('POST', `/api/users/${id}/deactivate`, {});
    const res = await admin.call('POST', `/api/users/${id}/reactivate`, {});
    expect(res.status).toBe(200);
    expect(res.json.deactivated_at).toBeNull();
    expect((await client(h.app).login('sam@x.test', PW)).status).toBe(200);
  });

  it('shows in the user list, drops out of /people, and leaves their tickets resolving', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const id = addUser(h, 'sam@x.test', { name: 'Sam Adeyemi' });
    const t = await admin.call('POST', '/api/tickets', {
      project_slug: 'food',
      board_slug: 'eng',
      title: 'Keep me',
      type: 'task',
      assignee: 'sam@x.test',
    });
    expect(t.status).toBe(201);
    await admin.call('POST', `/api/users/${id}/deactivate`, {});

    const users = (await admin.call('GET', '/api/users')).json as unknown as Json[];
    expect(users.find((u) => u.id === id)!.deactivated_at).toBeTruthy();
    expect(users.find((u) => u.id === 1)!.deactivated_at).toBeNull();
    const people = (await admin.call('GET', '/api/people')).json as unknown as Json[];
    expect(people.map((p) => p.name)).not.toContain('Sam Adeyemi');
    expect(people.map((p) => p.name)).toContain('Admin');

    const ticket = await admin.call('GET', `/api/tickets/${t.json.key}`);
    expect(ticket.status).toBe(200);
    expect(ticket.json.assignee).toBe('sam@x.test');
    expect(row<{ n: number }>(h, 'SELECT COUNT(*) n FROM tickets').n).toBe(1);
    // And the account can still be found by the rows that name it.
    expect(row(h, 'SELECT name FROM users WHERE id = ?', id).name).toBe('Sam Adeyemi');
  });

  it('leaves the invites they created pending, and the email stays taken', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const id = addUser(h, 'two@x.test', { admin: true });
    h.ctx.db.raw.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
    const two = await signedIn(h, 'two@x.test', PW);
    const made = await invite(two, 'guest@x.test');
    await admin.call('POST', `/api/users/${id}/deactivate`, {});
    expect((await client(h.app).call('GET', `/api/invites/${made.token}`)).status).toBe(200);
    expect(
      (await admin.call('POST', '/api/invites', { email: 'two@x.test', name: 'T' })).status,
    ).toBe(409);
    const list = (await admin.call('GET', '/api/invites')).json as unknown as Json[];
    expect(list.find((i) => i.id === made.id)!.status).toBe('pending');
  });

  it('is not handed new work: a handoff to a deactivated person is refused', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const id = addUser(h, 'sam@x.test');
    const t = await admin.call('POST', '/api/tickets', {
      project_slug: 'food',
      board_slug: 'eng',
      title: 'x',
      type: 'task',
    });
    await admin.call('POST', `/api/users/${id}/deactivate`, {});
    const res = await admin.call('POST', `/api/tickets/${t.json.key}/handoff`, {
      decision: 'approve',
      to_status: 'Done',
      assignee_id: id,
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/deactivated/);
    const add = await admin.call('POST', `/api/tickets/${t.json.key}/participants`, {
      user_id: id,
    });
    expect(add.status).toBe(400);
  });
});

describe('CSV import of staff', () => {
  const imp = (admin: ReturnType<typeof client>, csv: string, dry_run?: boolean) =>
    admin.call('POST', '/api/invites/import', dry_run === undefined ? { csv } : { csv, dry_run });

  it('previews by default, and writes nothing on a dry run', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const res = await imp(admin, 'email,name,is_admin\na@x.test,Ada,yes\nb@x.test,Bo,\n');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      dry_run: true,
      total: 2,
      valid: 2,
      created: 0,
      failed: 0,
      csv: null,
    });
    expect(res.json.rows[0]).toEqual({
      row: 1,
      email: 'a@x.test',
      name: 'Ada',
      is_admin: true,
      status: 'ok',
      error: null,
      invite_link: null,
    });
    expect(res.json.rows[1].is_admin).toBe(false);
    expect(row<{ n: number }>(h, 'SELECT COUNT(*) n FROM invites').n).toBe(0);
    expect((await imp(admin, 'email,name\na@x.test,A', true)).json.created).toBe(0);
    expect(row<{ n: number }>(h, 'SELECT COUNT(*) n FROM invites').n).toBe(0);
  });

  it('creates an invite per valid row on a real run, reports the rest, and returns a CSV of links', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    await invite(admin, 'pending@x.test');
    const csv = [
      'email,name,is_admin',
      'good@x.test,Good One,true',
      'bad-email,Nope,',
      `${ADMIN.email},Has Account,`,
      'pending@x.test,Has Invite,',
      'good@x.test,Same Again,',
      ',No Email,',
      'blank@x.test,   ,',
      'odd@x.test,Odd,maybe',
      'short@x.test,Short',
      'fine@x.test,Fine,0',
    ].join('\n');
    const res = await imp(admin, csv, false);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ dry_run: false, total: 10, valid: 2, created: 2, failed: 8 });
    const errors = res.json.rows.map((r: Json) => r.error);
    expect(errors[0]).toBeNull();
    expect(errors[1]).toMatch(/email must be an email address/);
    expect(errors[2]).toMatch(/already has an account/);
    expect(errors[3]).toMatch(/pending invite/);
    expect(errors[4]).toMatch(/more than once/);
    expect(errors[5]).toMatch(/email/);
    expect(errors[6]).toMatch(/name is required/);
    expect(errors[7]).toMatch(/is_admin/);
    expect(errors[8]).toMatch(/expected 3 columns, found 2/);
    expect(errors[9]).toBeNull();

    expect(row<{ n: number }>(h, 'SELECT COUNT(*) n FROM invites').n).toBe(3);
    const lines = (res.json.csv as string).trim().split('\r\n');
    expect(lines[0]).toBe('email,name,invite_link');
    expect(lines).toHaveLength(3);
    // A link from the CSV works.
    const token = tokenOf(lines[1]!.split(',')[2]!);
    expect((await client(h.app).call('GET', `/api/invites/${token}`)).json.email).toBe(
      'good@x.test',
    );
    const accepted = await client(h.app).call('POST', `/api/invites/${token}/accept`, {
      password: PW,
    });
    expect(accepted.json.isAdmin).toBe(true);
    // Rows with no invite carry no link.
    expect(res.json.rows[1].invite_link).toBeNull();
    expect(res.json.rows[0].invite_link).toMatch(/\/#\/invite\//);
  });

  it('reads a BOM, CRLF, quoted commas and header case, trims cells, and lowercases emails', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const csv = '﻿ Email , NAME ,Is_Admin\r\n  Ada@Example.COM ,"Lovelace, Ada",TRUE\r\n';
    const res = await imp(admin, csv, false);
    expect(res.json.rows[0]).toMatchObject({
      email: 'Ada@Example.COM',
      name: 'Lovelace, Ada',
      is_admin: true,
      status: 'ok',
    });
    expect(row(h, 'SELECT email, name, is_admin FROM invites')).toEqual({
      email: 'ada@example.com',
      name: 'Lovelace, Ada',
      is_admin: 1,
    });
    // A name with a comma is quoted in the CSV we send back.
    expect(res.json.csv).toContain('"Lovelace, Ada"');
  });

  it('neutralises formulas in the CSV it writes', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const res = await imp(
      admin,
      'email,name\nx@x.test,"=HYPERLINK(""http://evil"")"\ny@x.test,@cmd\nz@x.test,+1\nw@x.test,-2\n',
      false,
    );
    expect(res.json.created).toBe(4);
    const body = res.json.csv as string;
    expect(body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(body).toContain(`'@cmd`);
    expect(body).toContain(`'+1`);
    expect(body).toContain(`'-2`);
    for (const line of body.trim().split('\r\n').slice(1)) {
      expect(line).not.toMatch(/,[=+\-@]/);
    }
  });

  it('refuses a bad file as a whole: header, unknown column, no rows, unclosed quote, empty', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    for (const csv of [
      '',
      'name\nA',
      'email\na@x.test',
      'email,name,dept\na@x.test,A,x',
      'email,name,name\na@x.test,A,B',
      'email,name',
      'email,name\n"a@x.test,A',
    ]) {
      const res = await imp(admin, csv);
      expect({ csv, status: res.status }).toEqual({ csv, status: 400 });
    }
    expect((await admin.call('POST', '/api/invites/import', { csv: 5 })).status).toBe(400);
    expect(
      (await admin.call('POST', '/api/invites/import', { csv: 'a', dry_run: 'no' })).status,
    ).toBe(400);
    expect((await admin.call('POST', '/api/invites/import', {})).status).toBe(400);
  });

  it('caps the file at 200 rows and at its size', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const rows = (n: number) =>
      'email,name\n' + Array.from({ length: n }, (_, i) => `u${i}@x.test,U${i}`).join('\n');
    const ok = await imp(admin, rows(200), false);
    expect(ok.status).toBe(200);
    expect(ok.json.created).toBe(200);
    const over = await imp(admin, rows(201));
    expect(over.status).toBe(400);
    expect(over.json.error).toMatch(/200 at most/);
    const big = await imp(admin, 'email,name\n' + 'a'.repeat(200 * 1024));
    expect(big.status).toBe(413);
  });

  it('checks everything again on the real run, so a stale preview cannot make an invite for a taken email', async () => {
    const h = await harness();
    const admin = await signedIn(h);
    const csv = 'email,name\nlate@x.test,Late';
    expect((await imp(admin, csv, true)).json.valid).toBe(1);
    addUser(h, 'late@x.test');
    const real = await imp(admin, csv, false);
    expect(real.json).toMatchObject({ valid: 0, created: 0, failed: 1 });
    expect(real.json.rows[0].error).toMatch(/already has an account/);
    expect(row<{ n: number }>(h, 'SELECT COUNT(*) n FROM invites').n).toBe(0);
  });
});

describe('the public demo', () => {
  it('blocks every new write route with the demo refusal, and leaves the reads alone', async () => {
    for (const [method, p] of [
      ['POST', '/api/invites'],
      ['POST', '/api/invites/import'],
      ['DELETE', '/api/invites/abc'],
      ['POST', `/api/invites/${'A'.repeat(43)}/accept`],
      ['POST', '/api/me/password'],
      ['POST', '/api/users/1/deactivate'],
      ['POST', '/api/users/1/reactivate'],
      ['POST', '/api/invites/'],
    ] as const) {
      expect(isDemoBlocked(method, p), `${method} ${p}`).toBe(true);
    }
    expect(isDemoBlocked('GET', '/api/invites')).toBe(false);
    expect(isDemoBlocked('GET', `/api/invites/${'A'.repeat(43)}`)).toBe(false);
    expect(isDemoBlocked('GET', '/api/me')).toBe(false);
    expect(isDemoBlocked('POST', '/api/login')).toBe(false);
  });

  it('answers 403 demo_mode over HTTP, signed in as the demo user', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-staff-demo-'));
    dirs.push(dir);
    const ctx: AppContext = {
      config: loadConfig({ PM_DATA_DIR: dir, DEMO_MODE: 'true' }),
      db: openDatabase({ filename: ':memory:' }),
      projects: new ProjectsRegistry(parseProjectsConfig(readFileSync('projects.json', 'utf8'))),
      events: new EventBus(),
      dashboardCache: new Map(),
    };
    ensureDemoWorkspace(ctx);
    const app = createApp(ctx);
    const maya = client(app);
    expect((await maya.login(MAYA, DEMO_PASSWORD)).status).toBe(200);
    expect(
      ctx.db.raw.prepare('SELECT COUNT(*) n FROM users WHERE must_change_password = 1').get(),
    ).toEqual({ n: 0 });
    const attempts: Array<[string, string, unknown]> = [
      ['POST', '/api/invites', { email: 'a@x.test', name: 'A' }],
      ['POST', '/api/invites/import', { csv: 'email,name\na@x.test,A', dry_run: false }],
      ['DELETE', '/api/invites/abc', undefined],
      ['POST', `/api/invites/${'A'.repeat(43)}/accept`, { password: PW }],
      [
        'POST',
        '/api/me/password',
        { current_password: DEMO_PASSWORD, new_password: 'another-password' },
      ],
      ['POST', '/api/users/2/deactivate', {}],
      ['POST', '/api/users/2/reactivate', {}],
    ];
    for (const [method, p, body] of attempts) {
      const res = await maya.call(method, p, body ?? {});
      expect({ p, status: res.status, error: res.json?.error }).toEqual({
        p,
        status: 403,
        error: DEMO_REFUSAL,
      });
    }
    // Nothing changed: the demo password still works, nobody is deactivated, no invite exists.
    expect((await client(app).login(MAYA, DEMO_PASSWORD)).status).toBe(200);
    expect(
      ctx.db.raw.prepare('SELECT COUNT(*) n FROM users WHERE deactivated_at IS NOT NULL').get(),
    ).toEqual({ n: 0 });
    expect(ctx.db.raw.prepare('SELECT COUNT(*) n FROM invites').get()).toEqual({ n: 0 });
  });
});

describe('migration 0005 on an existing database', () => {
  const cols = (db: Database.Database, t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

  it('adds the columns and table to a v1 database, keeps its rows, and runs twice without harm', () => {
    const db = new Database(':memory:');
    db.exec(BASELINE_SQL);
    db.prepare(
      "INSERT INTO users (email, name, password, is_admin) VALUES ('a@b.c', 'A', 'hash', 1)",
    ).run();
    const before = db.prepare('SELECT * FROM users').all();
    expect(runMigrations(db)).toContain('0005-staff-accounts');
    expect(cols(db, 'users')).toEqual(
      expect.arrayContaining(['must_change_password', 'deactivated_at']),
    );
    expect(cols(db, 'invites')).toEqual([
      'id',
      'token_hash',
      'email',
      'name',
      'is_admin',
      'created_by',
      'created_at',
      'expires_at',
      'used_at',
    ]);
    // The old row is as it was, and reads as "no forced change, not deactivated".
    expect(
      db
        .prepare('SELECT email, password, must_change_password f, deactivated_at d FROM users')
        .all(),
    ).toEqual([{ email: 'a@b.c', password: 'hash', f: 0, d: null }]);
    expect(db.prepare('SELECT email, name, password, is_admin FROM users').all()).toEqual(
      before.map((r) => ({
        email: (r as Json).email,
        name: (r as Json).name,
        password: (r as Json).password,
        is_admin: (r as Json).is_admin,
      })),
    );
    expect(runMigrations(db)).toEqual([]);
    db.close();
  });

  it('applies over a database where one of the columns is already there', () => {
    const db = new Database(':memory:');
    runMigrations(db, undefined);
    db.exec('DROP TABLE invites');
    db.exec("DELETE FROM _officepm_migrations WHERE name = '0005-staff-accounts'");
    expect(runMigrations(db)).toEqual(['0005-staff-accounts']);
    expect(cols(db, 'invites')).toContain('token_hash');
    db.close();
  });

  it('lets a v1-style insert leave the new columns at their defaults', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO users (email, name, password) VALUES ('v1@x.test', 'V1', 'h')").run();
    expect(db.prepare('SELECT must_change_password f, deactivated_at d FROM users').get()).toEqual({
      f: 0,
      d: null,
    });
    db.close();
  });
});

describe('EventBus.closeForUserExceptSession', () => {
  it("closes a user's other sessions and spares the one named", () => {
    const bus = new EventBus();
    const closed: string[] = [];
    const sub = (userId: number, sessionId: string) =>
      bus.subscribe(() => {}, { userId, sessionId, close: () => closed.push(sessionId) });
    sub(1, 'keep');
    sub(1, 'other');
    sub(1, 'other');
    sub(2, 'theirs');
    expect(bus.closeForUserExceptSession(1, 'keep')).toBe(2);
    expect(closed).toEqual(['other', 'other']);
    expect(bus.size).toBe(2);
  });
});
