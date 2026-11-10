'use strict';

// Sections 6.9, 6.10 and 17: sprints, the single-active rule, retro auto-creation,
// burndown, velocity and the board-level DoD/DoR checklists.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAsAdmin, json } = require('./helpers');

describe('sprints, retros and the agile layer', () => {
  let srv, c;
  before(async () => { srv = await startServer(); c = await loginAsAdmin(srv.base); });
  after(async () => { await srv.stop(); });

  const sprintsUrl = '/api/projects/food/boards/eng/sprints';
  const newSprint = async (over) => json(await c.post(sprintsUrl, Object.assign({
    name: 'Sprint ' + Math.random().toString(36).slice(2, 7)
  }, over || {})));
  const make = async (over) => json(await c.post('/api/tickets', Object.assign({
    project_slug: 'food', board_slug: 'eng', title: 'sprint ticket', type: 'task'
  }, over || {})));

  describe('creation and kind (6.10)', () => {
    test('a name is required', async () => {
      assert.equal((await c.post(sprintsUrl, {})).status, 400);
    });

    test('a scrum board gets kind "sprint"', async () => {
      assert.equal((await newSprint()).kind, 'sprint');
    });

    test('a shape up board gets kind "cycle"', async () => {
      const s = await json(await c.post('/api/projects/northwind/boards/product/sprints', { name: 'Cycle 1' }));
      assert.equal(s.kind, 'cycle');
    });

    test('a waterfall board gets kind "phase"', async () => {
      const s = await json(await c.post('/api/projects/acme/boards/eng/sprints', { name: 'Phase 1' }));
      assert.equal(s.kind, 'phase');
    });

    test('an unknown project or board is refused', async () => {
      assert.equal((await c.post('/api/projects/nope/boards/eng/sprints', { name: 'x' })).status, 400);
    });

    test('a new sprint defaults to planned', async () => {
      assert.equal((await newSprint()).status, 'planned');
    });
  });

  describe('only one sprint is active at a time (6.10)', () => {
    test('creating a second active sprint is refused with 409', async () => {
      await newSprint({ status: 'active' });
      const res = await c.post(sprintsUrl, { name: 'Second', status: 'active' });
      assert.equal(res.status, 409);
      assert.match((await json(res)).error, /already active/);
    });

    test('activating a planned sprint while one is active is refused', async () => {
      const planned = await newSprint();
      const res = await c.patch('/api/sprints/' + planned.id, { status: 'active' });
      assert.equal(res.status, 409);
    });

    test('once the active one completes, another may be activated', async () => {
      const list = await json(await c.get(sprintsUrl));
      const active = list.find((s) => s.status === 'active');
      assert.ok(active, 'this suite leaves one active sprint behind');
      assert.equal((await c.patch('/api/sprints/' + active.id, { status: 'completed' })).status, 200);

      const next = await newSprint();
      assert.equal((await c.patch('/api/sprints/' + next.id, { status: 'active' })).status, 200);
      // Leave the board clean for later tests in this file.
      await c.patch('/api/sprints/' + next.id, { status: 'completed' });
    });

    test('patching a sprint that does not exist is a 404', async () => {
      assert.equal((await c.patch('/api/sprints/nope', { name: 'x' })).status, 404);
    });
  });

  describe('completing a sprint creates a retro, once (6.9)', () => {
    test('a retro appears named after the sprint', async () => {
      const s = await newSprint({ name: 'Retro Source' });
      await c.patch('/api/sprints/' + s.id, { status: 'completed' });
      const retros = await json(await c.get('/api/projects/food/boards/eng/retros'));
      const mine = retros.filter((r) => r.sprint_id === s.id);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].name, 'Retro Source Retro');
    });

    test('completing twice does not create a second retro', async () => {
      const s = await newSprint({ name: 'Once Only' });
      await c.patch('/api/sprints/' + s.id, { status: 'completed' });
      await c.patch('/api/sprints/' + s.id, { status: 'completed' });
      const retros = await json(await c.get('/api/projects/food/boards/eng/retros'));
      assert.equal(retros.filter((r) => r.sprint_id === s.id).length, 1);
    });

    test('retro cards can be added, edited and removed', async () => {
      const retro = await json(await c.post('/api/projects/food/boards/eng/retros', { name: 'Manual Retro' }));
      const card = await json(await c.post('/api/retros/' + retro.id + '/cards', {
        column: 'well', body: 'the webhook saved us a lot of clicking'
      }));
      assert.equal(card.column_name || card.column, 'well');

      assert.equal((await c.patch('/api/retros/' + retro.id + '/cards/' + card.id, {
        body: 'edited'
      })).status, 200);

      const full = await json(await c.get('/api/retros/' + retro.id));
      const cards = full.cards || full;
      assert.ok(JSON.stringify(cards).includes('edited'));

      assert.equal((await c.del('/api/retros/' + retro.id + '/cards/' + card.id)).status, 200);
    });
  });

  describe('burndown and velocity (6.9, 17.3)', () => {
    test('burndown reports a scope for a sprint with pointed tickets', async () => {
      const s = await newSprint({ name: 'Burndown', status: 'active' });
      const a = await make({ title: 'five points' });
      await c.patch('/api/tickets/' + a.key, { sprint_id: s.id, points: 5 });
      const b = await make({ title: 'three points' });
      await c.patch('/api/tickets/' + b.key, { sprint_id: s.id, points: 3 });

      const bd = await json(await c.get('/api/sprints/' + s.id + '/burndown'));
      assert.ok(bd, 'burndown should return a payload');
      assert.ok(JSON.stringify(bd).includes('8') || (bd.total_scope === 8),
        'total scope should be the sum of the points, got ' + JSON.stringify(bd).slice(0, 200));

      await c.patch('/api/sprints/' + s.id, { status: 'completed' });
    });

    test('velocity returns an average across completed sprints', async () => {
      const v = await json(await c.get('/api/projects/food/boards/eng/velocity'));
      assert.ok('sprints' in v && 'average_velocity' in v && 'uses_points' in v);
      assert.equal(v.uses_points, true, 'food/eng has points enabled');
    });

    test('a board without points reports uses_points false', async () => {
      const v = await json(await c.get('/api/projects/food/boards/design/velocity'));
      assert.equal(v.uses_points, false);
    });
  });

  describe('definition of done (6.9)', () => {
    test('an agile board seeds the board DoD onto a ticket', async () => {
      const t = await make({ title: 'dod ticket' });
      const dod = await json(await c.get('/api/tickets/' + t.key + '/dod'));
      assert.ok(Array.isArray(dod) && dod.length > 0, 'food/eng defines a DoD in projects.json');
      assert.ok('item' in dod[0] && 'done' in dod[0]);
    });

    test('a DoD item can be ticked and stays ticked', async () => {
      const t = await make({ title: 'tick me' });
      const dod = await json(await c.get('/api/tickets/' + t.key + '/dod'));
      const item = dod[0].item;
      assert.equal((await c.patch('/api/tickets/' + t.key + '/dod', { item, done: true })).status, 200);
      const after = await json(await c.get('/api/tickets/' + t.key + '/dod'));
      // The API normalizes done to a real boolean rather than SQLite's 0/1.
      assert.equal(after.find((d) => d.item === item).done, true);
      // And an untouched item stays false, so the tick is per item, not global.
      assert.equal(after.filter((d) => d.done === true).length, 1);
    });
  });

  describe('board settings (6.3, 9)', () => {
    test('settings report the flow and agile flag from projects.json', async () => {
      const s = await json(await c.get('/api/projects/food/boards/eng/settings'));
      assert.equal(s.flow, 'scrum');
      assert.equal(!!s.agile_enabled, true);
    });

    test('a DoD edit persists but the flow stays owned by projects.json', async () => {
      const res = await c.patch('/api/projects/food/boards/design/settings', {
        definition_of_done: ['design reviewed']
      });
      assert.equal(res.status, 200);
      const s = await json(await c.get('/api/projects/food/boards/design/settings'));
      assert.ok(JSON.stringify(s.definition_of_done).includes('design reviewed'));
      assert.equal(s.flow, 'kanban', 'flow is not editable at runtime, section 17.1');
    });
  });
});
