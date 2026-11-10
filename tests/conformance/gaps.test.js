'use strict';

// Tests for the gaps found when the code was audited against the PRD on
// 2026-09-27. Each one failed before the fix beside it.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAsAdmin, json } = require('./helpers');

describe('audit gaps', () => {
  let srv, c;
  before(async () => { srv = await startServer(); c = await loginAsAdmin(srv.base); });
  after(async () => { await srv.stop(); });

  const make = async (over) => json(await c.post('/api/tickets', Object.assign({
    project_slug: 'food', board_slug: 'eng', title: 'gap ticket', type: 'task'
  }, over || {})));

  describe('search happens on the server (7.4)', () => {
    before(async () => {
      await make({ title: 'unmistakable needle in the haystack' });
      for (let i = 0; i < 5; i++) await make({ title: 'filler ' + i });
    });

    test('q filters by title', async () => {
      const rows = await json(await c.get('/api/tickets?q=unmistakable'));
      assert.equal(rows.length, 1);
      assert.match(rows[0].title, /unmistakable/);
    });

    test('q filters by key, case insensitively', async () => {
      const t = await make({ title: 'find me by key' });
      const rows = await json(await c.get('/api/tickets?q=' + t.key.toLowerCase()));
      assert.ok(rows.some((r) => r.key === t.key));
    });

    test('q matching nothing returns an empty list, not everything', async () => {
      const rows = await json(await c.get('/api/tickets?q=zzzzznothinghere'));
      assert.deepEqual(rows, []);
    });

    test('limit caps the response, which is what the palette relies on', async () => {
      const rows = await json(await c.get('/api/tickets?limit=3'));
      assert.equal(rows.length, 3);
    });

    test('an absurd or junk limit is ignored rather than trusted', async () => {
      for (const l of ['999999', '-1', '0', 'drop table', '']) {
        const res = await c.get('/api/tickets?limit=' + encodeURIComponent(l));
        assert.equal(res.status, 200, 'limit=' + l + ' must not error');
      }
    });

    test('q combines with the project and board filters', async () => {
      const design = await make({ board_slug: 'design', status: 'Backlog', title: 'unmistakable design item' });
      const rows = await json(await c.get('/api/tickets?board=design&q=unmistakable'));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].key, design.key);
    });
  });

  describe('sprint length defaults (6.10)', () => {
    test('a sprint created with no dates gets today plus 14 days', async () => {
      const s = await json(await c.post('/api/projects/food/boards/eng/sprints', { name: 'Defaulted' }));
      assert.ok(s.start_date, 'a start date should be filled in');
      assert.ok(s.end_date, 'an end date should be filled in');
      const days = (new Date(s.end_date) - new Date(s.start_date)) / 86400000;
      assert.equal(days, 14);
    });

    test('a shape up cycle defaults to 6 weeks', async () => {
      const s = await json(await c.post('/api/projects/northwind/boards/product/sprints', { name: 'Cycle A' }));
      assert.equal(s.kind, 'cycle');
      assert.equal((new Date(s.end_date) - new Date(s.start_date)) / 86400000, 42);
    });

    test('a given start date is respected and only the end is derived', async () => {
      const s = await json(await c.post('/api/projects/food/boards/eng/sprints', {
        name: 'Fixed start', start_date: '2026-03-02'
      }));
      assert.equal(s.start_date, '2026-03-02');
      assert.equal(s.end_date, '2026-03-16');
    });

    test('explicit dates are never overwritten', async () => {
      const s = await json(await c.post('/api/projects/food/boards/eng/sprints', {
        name: 'Both given', start_date: '2026-03-02', end_date: '2026-03-06'
      }));
      assert.equal(s.start_date, '2026-03-02');
      assert.equal(s.end_date, '2026-03-06');
    });
  });

  describe('cooldown is reachable (6.10, 8.3)', () => {
    test('a shape up board can create a cooldown, defaulting to 2 weeks', async () => {
      const s = await json(await c.post('/api/projects/northwind/boards/product/sprints', {
        name: 'Cooldown A', kind: 'cooldown'
      }));
      assert.equal(s.kind, 'cooldown');
      assert.equal((new Date(s.end_date) - new Date(s.start_date)) / 86400000, 14);
    });

    test('a cooldown is refused on a board that is not shape up', async () => {
      const res = await c.post('/api/projects/food/boards/eng/sprints', {
        name: 'Wrong flow', kind: 'cooldown'
      });
      assert.equal(res.status, 400);
      assert.match((await json(res)).error, /kind must be one of/);
    });

    test('an invented kind is refused', async () => {
      const res = await c.post('/api/projects/food/boards/eng/sprints', { name: 'x', kind: 'iteration' });
      assert.equal(res.status, 400);
    });

    test('a cooldown still obeys the single-active rule', async () => {
      const cycle = await json(await c.post('/api/projects/northwind/boards/product/sprints', {
        name: 'Active cycle', kind: 'cycle', status: 'active'
      }));
      const res = await c.post('/api/projects/northwind/boards/product/sprints', {
        name: 'Overlapping cooldown', kind: 'cooldown', status: 'active'
      });
      assert.equal(res.status, 409);
      await c.patch('/api/sprints/' + cycle.id, { status: 'completed' });
    });
  });
});
