'use strict';

// Regression tests for the security fixes in the git history. Each block names
// the bug it guards, because the value of these is that a future refactor that
// reintroduces one fails here instead of in production.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAsAdmin, client, json, ADMIN, PM_TOKEN } = require('./helpers');

describe('security', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.stop(); });

  describe('session expiry (fa165a3: expiry was never enforced)', () => {
    test('a valid session reaches a protected route', async () => {
      const c = await loginAsAdmin(srv.base);
      assert.equal((await c.get('/api/me')).status, 200);
    });

    test('an expired session is rejected with 401', async () => {
      const c = await loginAsAdmin(srv.base);
      const sid = c.cookie().split('=')[1];

      // Backdate this session in the database rather than waiting seven days.
      const db = srv.db();
      const changed = db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(sid);
      db.close();
      assert.equal(changed.changes, 1, 'the session row should exist to be backdated');

      const res = await c.get('/api/me');
      assert.equal(res.status, 401, 'an expired cookie must not authenticate');
      assert.equal((await json(res)).error, 'session expired');
    });

    test('expiry is compared as a datetime, not as a string', async () => {
      // The original bug: comparing a raw expires_at string against
      // datetime('now') silently accepted expired rows whose format differed.
      const c = await loginAsAdmin(srv.base);
      const sid = c.cookie().split('=')[1];
      const db = srv.db();
      // An ISO-8601 string with a T separator and a Z suffix, which does not
      // compare correctly against SQLite's 'YYYY-MM-DD HH:MM:SS' as text.
      db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .run(new Date(Date.now() - 86400000).toISOString(), sid);
      db.close();
      assert.equal((await c.get('/api/me')).status, 401);
    });
  });

  describe('password reset kills sessions (fa165a3)', () => {
    test('a stolen cookie stops working after the password is reset', async () => {
      const admin = await loginAsAdmin(srv.base);
      const created = await json(await admin.post('/api/users', {
        email: 'victim@officepm.local', name: 'Victim', password: 'original-password'
      }));

      const victim = client(srv.base);
      assert.equal((await victim.post('/api/login', {
        email: 'victim@officepm.local', password: 'original-password'
      })).status, 200);
      assert.equal((await victim.get('/api/me')).status, 200, 'victim is logged in');

      // Admin resets the password, which is the action taken after a suspected
      // compromise. The already-issued cookie must die with it.
      assert.equal((await admin.patch('/api/users/' + created.id + '/password', {
        password: 'brand-new-password'
      })).status, 200);

      assert.equal((await victim.get('/api/me')).status, 401,
        'the pre-reset session must be invalidated, not just the password');
    });
  });

  describe('url scheme allowlist (267f824)', () => {
    const hostile = [
      'javascript:alert(document.cookie)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'not a url at all'
    ];

    test('project docs reject non-http(s) urls', async () => {
      const c = await loginAsAdmin(srv.base);
      for (const url of hostile) {
        const res = await c.post('/api/projects/food/docs', { title: 'x', kind: 'link', url });
        assert.equal(res.status, 400, 'should reject ' + url);
      }
    });

    test('ticket links reject non-http(s) urls', async () => {
      const c = await loginAsAdmin(srv.base);
      const t = await json(await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'eng', title: 'link host', type: 'task'
      }));
      for (const url of hostile) {
        const res = await c.post('/api/tickets/' + t.key + '/links', { title: 'x', url });
        assert.equal(res.status, 400, 'should reject ' + url);
      }
    });

    test('ordinary http and https urls are still accepted', async () => {
      const c = await loginAsAdmin(srv.base);
      for (const url of ['http://example.com/a', 'https://example.com/b?c=d#e']) {
        const res = await c.post('/api/projects/food/docs', { title: 'ok', kind: 'link', url });
        assert.equal(res.status, 201, 'should accept ' + url);
      }
    });
  });

  describe('blocked file extensions (a879821, and the trailing dot/space bypass)', () => {
    async function upload(c, key, filename, body) {
      const form = new FormData();
      form.append('file', new Blob([body || 'payload'], { type: 'application/octet-stream' }), filename);
      return c.post('/api/tickets/' + key + '/files', form);
    }

    test('blocked extensions are refused, including padded variants', async () => {
      const c = await loginAsAdmin(srv.base);
      const t = await json(await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'eng', title: 'upload host', type: 'task'
      }));
      const names = [
        'evil.exe', 'evil.EXE', 'evil.sh', 'evil.bat', 'evil.cmd',
        'evil.js', 'evil.html', 'evil.htm',
        'evil.exe.', 'evil.exe ', 'evil.exe...', 'evil.exe   '
      ];
      for (const n of names) {
        const res = await upload(c, t.key, n);
        assert.ok(res.status >= 400, JSON.stringify(n) + ' must be refused, got ' + res.status);
      }
    });

    test('an ordinary document uploads and downloads as an attachment', async () => {
      const c = await loginAsAdmin(srv.base);
      const t = await json(await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'eng', title: 'download host', type: 'task'
      }));
      const res = await upload(c, t.key, 'spec.txt', 'hello');
      assert.equal(res.status, 201);
      const created = await json(res);

      const dl = await c.get('/api/tickets/' + t.key + '/files/' + created.id);
      assert.equal(dl.status, 200);
      assert.match(dl.headers.get('content-disposition') || '', /attachment/,
        'files must never be served inline');
      assert.equal(await dl.text(), 'hello');
    });

    test('file downloads require a session', async () => {
      const c = await loginAsAdmin(srv.base);
      const t = await json(await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'eng', title: 'auth host', type: 'task'
      }));
      const created = await json(await upload(c, t.key, 'private.txt', 'secret'));
      const anon = client(srv.base);
      assert.equal((await anon.get('/api/tickets/' + t.key + '/files/' + created.id)).status, 401);
    });

    test('a traversal filename is stripped of its path, on disk and in the record', async () => {
      const c = await loginAsAdmin(srv.base);
      const t = await json(await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'eng', title: 'traversal host', type: 'task'
      }));
      const created = await json(await upload(c, t.key, '../../../../etc/passwd.txt', 'x'));

      // Both halves matter. The display name keeps no path components, so it
      // cannot mislead in the UI, and the path on disk is a uuid, so the
      // uploaded name never reaches the filesystem at all.
      assert.equal(created.original_name, 'passwd.txt');
      assert.equal(created.original_name.includes('/'), false);
      assert.equal(created.original_name.includes('..'), false);

      const db = srv.db();
      const row = db.prepare('SELECT stored_path FROM ticket_files WHERE id = ?').get(created.id);
      db.close();
      assert.equal(row.stored_path.includes('..'), false, 'the uploaded name is never used as the path');
      assert.match(row.stored_path, /[0-9a-f-]{36}\.txt$/);
      assert.ok(row.stored_path.startsWith(srv.dataDir), 'must stay inside the data directory');
    });
  });

  describe('github webhook authentication (6.7, 12)', () => {
    test('a missing or wrong token is rejected', async () => {
      for (const headers of [{}, { 'x-pm-token': 'wrong' }, { 'x-pm-token': '' }]) {
        const res = await fetch(srv.base + '/api/github/pr-opened', {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, headers),
          body: JSON.stringify({ branch: 'fix/FOOD-ENG-1-x', repo: 'r' })
        });
        assert.equal(res.status, 401, 'token ' + JSON.stringify(headers) + ' must not pass');
      }
    });

    test('the correct token is accepted', async () => {
      const res = await fetch(srv.base + '/api/github/pr-opened', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pm-token': PM_TOKEN },
        body: JSON.stringify({ branch: 'fix/NOSUCH-1-x', repo: 'r' })
      });
      assert.equal(res.status, 200);
    });
  });

  describe('authentication basics (6.1)', () => {
    test('a wrong password does not log in', async () => {
      const c = client(srv.base);
      assert.equal((await c.post('/api/login', { email: ADMIN.email, password: 'nope' })).status, 401);
    });

    test('an unknown email does not log in', async () => {
      const c = client(srv.base);
      assert.equal((await c.post('/api/login', { email: 'ghost@nowhere', password: 'x' })).status, 401);
    });

    test('protected routes reject an anonymous caller', async () => {
      const anon = client(srv.base);
      for (const url of ['/api/me', '/api/tickets', '/api/overview', '/api/users', '/api/my-tickets']) {
        assert.equal((await anon.get(url)).status, 401, url + ' must require a session');
      }
    });

    test('the session cookie is httpOnly and sameSite=lax', async () => {
      const res = await fetch(srv.base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ADMIN)
      });
      const raw = (res.headers.getSetCookie() || []).join(';');
      assert.match(raw, /HttpOnly/i);
      assert.match(raw, /SameSite=Lax/i);
    });

    test('logging out invalidates the session server side', async () => {
      const c = await loginAsAdmin(srv.base);
      const stolen = c.cookie();
      assert.equal((await c.post('/api/logout')).status, 200);
      const replay = client(srv.base);
      replay.setCookie(stolen);
      assert.equal((await replay.get('/api/me')).status, 401,
        'the old cookie must be dead on the server, not just cleared in the browser');
    });

    test('a non-admin cannot reach admin routes', async () => {
      const admin = await loginAsAdmin(srv.base);
      await admin.post('/api/users', { email: 'plain@officepm.local', name: 'Plain', password: 'plain-password' });
      const plain = client(srv.base);
      await plain.post('/api/login', { email: 'plain@officepm.local', password: 'plain-password' });
      assert.equal((await plain.post('/api/users', {
        email: 'sneaky@officepm.local', name: 'S', password: 'sneaky-password'
      })).status, 403);
    });
  });
});
