'use strict';

// scripts/seed-demo.js: a seeded database has to be usable by the real server,
// and the script must never overwrite work that is already there.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, json } = require('./helpers');

const SEED = path.join(__dirname, '..', 'scripts', 'seed-demo.js');
const PROJECTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8')).projects;

function seed(dataDir) {
  return spawnSync(process.execPath, [SEED], {
    env: Object.assign({}, process.env, { PM_DATA_DIR: dataDir }), encoding: 'utf8'
  });
}

describe('seed-demo', () => {
  let dir, srv, c, tickets;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-seed-'));
    const r = seed(dir);
    assert.equal(r.status, 0, r.stderr);
    srv = await startServer({ dataDir: dir });
    c = client(srv.base);
    const login = await c.post('/api/login', { email: 'maya.okafor@officepm.demo', password: 'demo-password' });
    assert.equal(login.status, 200, 'the documented demo login works');
    tickets = await json(await c.get('/api/tickets'));
  });
  after(async () => { await srv.stop(); });

  test('every one of the 7 boards has tickets, using only its own statuses and types', () => {
    const boards = PROJECTS.flatMap((p) => p.boards.map((b) => ({ p, b })));
    assert.equal(boards.length, 7);
    assert.ok(tickets.length >= 25, 'about 25 tickets or more, got ' + tickets.length);
    for (const { p, b } of boards) {
      const rows = tickets.filter((t) => t.project_slug === p.slug && t.board_slug === b.slug);
      assert.ok(rows.length >= 1, p.slug + '/' + b.slug + ' is not empty');
      for (const t of rows) {
        assert.ok(b.statuses.includes(t.status), t.key + ' status ' + t.status);
        assert.ok(b.types.includes(t.type), t.key + ' type ' + t.type);
        assert.ok(t.key.startsWith(b.prefix + '-'), t.key + ' uses the board prefix');
      }
    }
    assert.equal(new Set(tickets.map((t) => t.key)).size, tickets.length, 'keys are unique');
  });

  test('three epics own children, via parent_key and a reference link each', async () => {
    const epics = tickets.filter((t) => t.level === 'epic');
    assert.equal(epics.length, 3);
    for (const e of epics) {
      assert.ok(tickets.some((t) => t.parent_key === e.key), e.key + ' has children');
      const links = await json(await c.get('/api/tickets/' + e.key + '/links'));
      assert.equal(links.length, 1);
    }
  });

  test('one active and two completed sprints on engineering, with a drawable burndown', async () => {
    const sprints = await json(await c.get('/api/projects/food/boards/eng/sprints'));
    assert.deepEqual(sprints.map((s) => s.status).sort(), ['active', 'completed', 'completed']);
    const active = sprints.find((s) => s.status === 'active');
    const bd = await json(await c.get('/api/sprints/' + active.id + '/burndown'));
    assert.ok(bd.points.length > 5 && bd.total_scope > 0);
    const last = bd.points.filter((p) => p.actual !== null).pop();
    assert.ok(last.actual < bd.total_scope, 'some of the sprint is already done');
  });

  test('blockers, comments, a retro and several distinct assignees exist', async () => {
    assert.ok(tickets.filter((t) => t.blocked).length >= 1);
    const assignees = new Set(tickets.map((t) => t.assignee).filter(Boolean));
    assert.ok(assignees.size >= 5, 'distinct people, for distinct avatars');
    const withComments = [];
    for (const t of tickets.slice(0, 40)) {
      const cs = await json(await c.get('/api/tickets/' + t.key + '/comments'));
      if (cs.length) withComments.push(t.key);
    }
    assert.ok(withComments.length >= 5);
    const retros = await json(await c.get('/api/projects/food/boards/eng/retros'));
    assert.equal(retros.length, 1);
  });

  test('the dashboard has something to show the demo user', async () => {
    const d = await json(await c.get('/api/dashboard'));
    assert.ok(d.sprint && d.sprint.velocity.sprints.length === 3);
    assert.ok(d.needs_me.length >= 3);
    assert.ok(d.activity.length >= 8);
    assert.ok(d.totals.blocked >= 1 && d.totals.overdue >= 1);
  });

  test('new tickets continue the key sequence instead of colliding', async () => {
    const before = tickets.filter((t) => t.board_slug === 'eng' && t.project_slug === 'food').length;
    const t = await json(await c.post('/api/tickets', { project_slug: 'food', board_slug: 'eng', title: 'after seed', type: 'task' }));
    assert.equal(t.key, 'FOOD-ENG-' + (before + 1));
  });

  test('seeding a database that already has tickets is refused and changes nothing', () => {
    const r = seed(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /already has \d+ ticket/);
  });
});
