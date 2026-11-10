'use strict';

// Ticket lifecycle, key generation and the per-flow rules. These are the paths
// every user touches, so a break here is a break in the product itself.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAsAdmin, json } = require('./helpers');

describe('tickets', () => {
  let srv, c;
  before(async () => { srv = await startServer(); c = await loginAsAdmin(srv.base); });
  after(async () => { await srv.stop(); });

  const make = async (over) => json(await c.post('/api/tickets', Object.assign({
    project_slug: 'food', board_slug: 'eng', title: 'a ticket', type: 'task'
  }, over || {})));

  describe('keys (section 5)', () => {
    test('keys use the board prefix and count up per board', async () => {
      const a = await make({ title: 'first' });
      const b = await make({ title: 'second' });
      assert.match(a.key, /^FOOD-ENG-\d+$/);
      const nA = Number(a.key.split('-').pop());
      const nB = Number(b.key.split('-').pop());
      assert.equal(nB, nA + 1, 'the sequence is per board, and consecutive');
    });

    test('a different board has its own prefix and its own sequence', async () => {
      const design = await make({ board_slug: 'design', status: 'Backlog' });
      assert.match(design.key, /^FOOD-DES-\d+$/);
      assert.equal(Number(design.key.split('-').pop()), 1,
        'a fresh board starts at 1 regardless of other boards');
    });

    test('an unknown project or board is refused', async () => {
      assert.equal((await c.post('/api/tickets', {
        project_slug: 'nope', board_slug: 'eng', title: 'x', type: 'task'
      })).status, 400);
      assert.equal((await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'nope', title: 'x', type: 'task'
      })).status, 400);
    });

    test('a title is required', async () => {
      assert.equal((await c.post('/api/tickets', {
        project_slug: 'food', board_slug: 'eng', type: 'task'
      })).status, 400);
    });
  });

  describe('field validation (6.4)', () => {
    test('a status outside the board\'s list is refused', async () => {
      const t = await make();
      const res = await c.patch('/api/tickets/' + t.key, { status: 'Somewhere Else' });
      assert.equal(res.status, 400);
      assert.match((await json(res)).error, /status must be one of/);
    });

    test('a type outside the board\'s list is refused', async () => {
      const t = await make();
      assert.equal((await c.patch('/api/tickets/' + t.key, { type: 'chore' })).status, 400);
    });

    test('a valid move sticks and is readable back', async () => {
      const t = await make();
      await c.patch('/api/tickets/' + t.key, { status: 'In Progress', assignee: 'admin@officepm.local' });
      const back = await json(await c.get('/api/tickets/' + t.key));
      assert.equal(back.status, 'In Progress');
      assert.equal(back.assignee, 'admin@officepm.local');
    });

    test('a deleted ticket is gone', async () => {
      const t = await make();
      assert.equal((await c.del('/api/tickets/' + t.key)).status, 200);
      assert.equal((await c.get('/api/tickets/' + t.key)).status, 404);
    });
  });

  describe('waterfall is sequential only (17.4)', () => {
    // acme/eng: Requirements, Design, Implementation, Testing, Deployed
    test('skipping a phase forward is refused with 409', async () => {
      const t = await make({ project_slug: 'acme', board_slug: 'eng', status: 'Requirements' });
      const res = await c.patch('/api/tickets/' + t.key, { status: 'Testing' });
      assert.equal(res.status, 409);
      assert.match((await json(res)).error, /sequential only/);
    });

    test('the next phase is allowed', async () => {
      const t = await make({ project_slug: 'acme', board_slug: 'eng', status: 'Requirements' });
      assert.equal((await c.patch('/api/tickets/' + t.key, { status: 'Design' })).status, 200);
      assert.equal((await c.patch('/api/tickets/' + t.key, { status: 'Implementation' })).status, 200);
    });

    test('moving backward is allowed, since that is fixing the sequence', async () => {
      const t = await make({ project_slug: 'acme', board_slug: 'eng', status: 'Requirements' });
      await c.patch('/api/tickets/' + t.key, { status: 'Design' });
      await c.patch('/api/tickets/' + t.key, { status: 'Implementation' });
      assert.equal((await c.patch('/api/tickets/' + t.key, { status: 'Requirements' })).status, 200);
    });

    test('a non-waterfall board may jump freely', async () => {
      const t = await make({ board_slug: 'design', status: 'Backlog' });
      assert.equal((await c.patch('/api/tickets/' + t.key, { status: 'Done' })).status, 200);
    });
  });

  describe('comments (6.5)', () => {
    test('a comment records its author and reads back', async () => {
      const t = await make();
      const res = await c.post('/api/tickets/' + t.key + '/comments', { body: 'looks right to me' });
      assert.equal(res.status, 201);
      const list = await json(await c.get('/api/tickets/' + t.key + '/comments'));
      assert.equal(list.length, 1);
      assert.equal(list[0].body, 'looks right to me');
      assert.equal(list[0].source, 'user');
      assert.equal(list[0].author, 'Admin');
    });

    test('an empty comment is refused', async () => {
      const t = await make();
      assert.equal((await c.post('/api/tickets/' + t.key + '/comments', { body: '' })).status, 400);
    });
  });

  describe('overview and my-tickets', () => {
    test('overview reports open, in progress and done in the last 7 days', async () => {
      const rows = await json(await c.get('/api/overview'));
      assert.ok(Array.isArray(rows) && rows.length >= 7, 'one row per board');
      for (const r of rows) {
        for (const k of ['project', 'project_slug', 'board', 'board_slug', 'open', 'in_progress', 'done_7d']) {
          assert.ok(k in r, 'overview row is missing ' + k);
        }
      }
    });

    test('my-tickets returns only the caller\'s assigned tickets', async () => {
      const mine = await make({ title: 'assigned to me' });
      await c.patch('/api/tickets/' + mine.key, { assignee: 'admin@officepm.local' });
      const other = await make({ title: 'someone else' });
      await c.patch('/api/tickets/' + other.key, { assignee: 'nobody@officepm.local' });

      const rows = await json(await c.get('/api/my-tickets'));
      const keys = rows.map((r) => r.key);
      assert.ok(keys.includes(mine.key));
      assert.ok(!keys.includes(other.key));
    });
  });
});
