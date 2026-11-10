'use strict';

// Priority, labels and due date: the optional card metadata, and the dashboard
// endpoint that reads it. Validation is checked at the API, not only in the UI.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAsAdmin, json } = require('./helpers');

describe('card fields', () => {
  let srv, c;
  before(async () => { srv = await startServer(); c = await loginAsAdmin(srv.base); });
  after(async () => { await srv.stop(); });

  const make = (over) => c.post('/api/tickets', Object.assign({
    project_slug: 'food', board_slug: 'eng', title: 'a ticket', type: 'task'
  }, over || {}));

  test('priority, labels and due_date round trip through create and patch', async () => {
    const t = await json(await make({ priority: 'high', labels: ['api', 'payments'], due_date: '2030-01-15' }));
    assert.equal(t.priority, 'high');
    assert.deepEqual(t.labels, ['api', 'payments']);
    assert.equal(t.due_date, '2030-01-15');

    const p = await json(await c.patch('/api/tickets/' + t.key, { priority: 'low', labels: [], due_date: null }));
    assert.equal(p.priority, 'low');
    assert.deepEqual(p.labels, []);
    assert.equal(p.due_date, null);
  });

  test('a ticket with no extras serialises empty labels, not null', async () => {
    const t = await json(await make());
    assert.deepEqual(t.labels, []);
    assert.equal(t.priority, null);
  });

  test('bad values are refused on create and on patch', async () => {
    assert.equal((await make({ priority: 'asap' })).status, 400);
    assert.equal((await make({ labels: 'api' })).status, 400);
    assert.equal((await make({ labels: ['x'.repeat(25)] })).status, 400);
    assert.equal((await make({ due_date: '15/01/2030' })).status, 400);
    assert.equal((await make({ due_date: '2030-02-31x' })).status, 400);
    const t = await json(await make());
    assert.equal((await c.patch('/api/tickets/' + t.key, { priority: 'asap' })).status, 400);
  });

  test('the dashboard works on an empty instance and needs a session', async () => {
    const anon = await fetch(srv.base + '/api/dashboard');
    assert.equal(anon.status, 401);
    const d = await json(await c.get('/api/dashboard'));
    assert.equal(d.boards.length, 7);
    assert.equal(d.sprint, null);
    assert.ok(Array.isArray(d.needs_me) && Array.isArray(d.activity));
  });

  test('the dashboard counts overdue and blocked, and lists my work first', async () => {
    const me = await json(await c.get('/api/me'));
    const overdue = await json(await make({ title: 'late', assignee: me.email, due_date: '2020-01-01', priority: 'urgent' }));
    await make({ title: 'fine', assignee: me.email, due_date: '2099-01-01' });
    const done = await json(await make({ title: 'finished', assignee: me.email, status: 'Done', due_date: '2020-01-01' }));
    const d = await json(await c.get('/api/dashboard'));
    assert.ok(d.totals.overdue >= 1);
    assert.equal(d.needs_me[0].key, overdue.key, 'the overdue urgent ticket sorts first');
    assert.ok(!d.needs_me.some((t) => t.key === done.key), 'a done ticket never needs me');
  });
});
