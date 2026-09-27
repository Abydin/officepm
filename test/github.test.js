'use strict';

// Section 6.7. This is the feature that justifies the tool: engineering status
// should update itself. It runs unauthenticated-by-session, on a CI token, and
// it writes to tickets, so it deserves the most careful tests in the suite.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAsAdmin, json, PM_TOKEN } = require('./helpers');

describe('github integration', () => {
  let srv, c;
  before(async () => { srv = await startServer(); c = await loginAsAdmin(srv.base); });
  after(async () => { await srv.stop(); });

  const hook = (path, body) => fetch(srv.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pm-token': PM_TOKEN },
    body: JSON.stringify(body)
  });

  const make = async (over) => json(await c.post('/api/tickets', Object.assign({
    project_slug: 'food', board_slug: 'eng', title: 'gh ticket', type: 'task'
  }, over || {})));

  const statusOf = async (key) => (await json(await c.get('/api/tickets/' + key))).status;
  const comments = async (key) => json(await c.get('/api/tickets/' + key + '/comments'));

  describe('pr opened', () => {
    test('a branch name moves the ticket to Code Review and comments', async () => {
      const t = await make();
      const res = await hook('/api/github/pr-opened', {
        branch: 'fix/' + t.key + '-safari', repo: 'office/food',
        url: 'https://github.com/office/food/pull/42', actor: 'abideen', number: 42
      });
      assert.equal(res.status, 200);
      assert.deepEqual((await json(res)).matched, [t.key]);
      assert.equal(await statusOf(t.key), 'Code Review');

      const sys = (await comments(t.key)).filter((x) => x.source === 'system');
      assert.equal(sys.length, 1);
      assert.match(sys[0].body, /PR opened/);
      assert.match(sys[0].body, /abideen/);
    });

    test('a key in the commit message is matched too', async () => {
      const t = await make();
      const res = await hook('/api/github/pr-opened', {
        branch: 'chore/no-key-here', commit_message: 'refactor router (' + t.key + ')', repo: 'r'
      });
      assert.deepEqual((await json(res)).matched, [t.key]);
    });

    test('an unknown key is ignored rather than erroring', async () => {
      const res = await hook('/api/github/pr-opened', { branch: 'fix/FOOD-ENG-99999-ghost', repo: 'r' });
      assert.equal(res.status, 200);
      assert.deepEqual((await json(res)).matched, []);
    });

    test('a board without has_github is never touched', async () => {
      // food/design has has_github: false
      const t = await make({ board_slug: 'design', status: 'Backlog' });
      const res = await hook('/api/github/pr-opened', { branch: 'fix/' + t.key + '-x', repo: 'r' });
      assert.deepEqual((await json(res)).matched, []);
      assert.equal(await statusOf(t.key), 'Backlog', 'a non-engineering board must not be moved by CI');
    });

    test('a hostile url is dropped rather than stored as an href', async () => {
      const t = await make();
      await hook('/api/github/pr-opened', {
        branch: 'fix/' + t.key + '-x', repo: 'r', url: 'javascript:alert(1)'
      });
      const links = await json(await c.get('/api/tickets/' + t.key + '/github'));
      assert.equal(links.length, 1, 'the event is still recorded');
      assert.equal(links[0].url, null, 'but the unsafe url is not kept');
    });
  });

  describe('deploy', () => {
    test('a staging deploy moves the ticket to QA', async () => {
      const t = await make();
      await hook('/api/github/deploy', {
        branch: 'release/' + t.key, environment: 'staging', repo: 'r'
      });
      assert.equal(await statusOf(t.key), 'QA');
    });

    test('a production deploy moves the ticket to Done', async () => {
      const t = await make();
      await hook('/api/github/deploy', {
        branch: 'release/' + t.key, environment: 'production', repo: 'r'
      });
      assert.equal(await statusOf(t.key), 'Done');
    });

    test('the environment is recorded on the event', async () => {
      const t = await make();
      await hook('/api/github/deploy', { branch: t.key, environment: 'production', repo: 'r' });
      const links = await json(await c.get('/api/tickets/' + t.key + '/github'));
      assert.equal(links[0].kind, 'deploy');
      assert.equal(links[0].environment, 'production');
    });
  });

  describe('release', () => {
    test('every key in a changelog is moved in one call', async () => {
      const a = await make({ title: 'in release a' });
      const b = await make({ title: 'in release b' });
      const res = await hook('/api/github/release', {
        tag: 'v1.4.0', repo: 'r',
        changelog: '* ' + a.key + ' fix checkout\n* ' + b.key + ' add history'
      });
      const matched = (await json(res)).matched;
      assert.ok(matched.includes(a.key) && matched.includes(b.key));
      assert.equal(await statusOf(a.key), 'Done');
      assert.equal(await statusOf(b.key), 'Done');
    });

    test('a changelog passed as an array works the same', async () => {
      const t = await make();
      const res = await hook('/api/github/release', {
        tag: 'v1.4.1', repo: 'r', changelog: [t.key + ' one', 'unrelated line']
      });
      assert.deepEqual((await json(res)).matched, [t.key]);
    });

    test('the release tag appears in the system comment', async () => {
      const t = await make();
      await hook('/api/github/release', { tag: 'v9.9.9', repo: 'r', changelog: t.key });
      const sys = (await comments(t.key)).filter((x) => x.source === 'system');
      assert.match(sys[sys.length - 1].body, /v9\.9\.9/);
    });
  });

  describe('key extraction', () => {
    test('a longer prefix wins over a shorter one that is its prefix', async () => {
      // FOOD-ENG and FOOD-ENG-like prefixes must not partially match. The
      // regex is built longest-first for exactly this reason.
      const t = await make();
      const res = await hook('/api/github/pr-opened', { branch: 'x/' + t.key + '/y', repo: 'r' });
      assert.deepEqual((await json(res)).matched, [t.key]);
    });

    test('a bare number or a lowercase key is not matched', async () => {
      const res = await hook('/api/github/pr-opened', { branch: 'fix/food-eng-1-lowercase 1234', repo: 'r' });
      assert.deepEqual((await json(res)).matched, []);
    });
  });
});
