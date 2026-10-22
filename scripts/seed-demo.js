#!/usr/bin/env node
'use strict';
/**
 * Fill an empty OfficePM database with a believable demo workspace.
 *
 *   npm run seed
 *
 * Reads the same PM_DATA_DIR and PM_PROJECTS_FILE variables as server.js, so it
 * seeds whichever database the server would open. It refuses to touch a database
 * that already has tickets, so it can never overwrite real work. Dates are
 * relative to today, so the active sprint always looks mid-flight.
 *
 * Demo login: maya.okafor@officepm.demo / demo-password (admin). Every demo user
 * shares that password. This is demo data only, never seed a database you expose
 * to a network.
 *
 * Only built-in modules plus the dependencies the server already has.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { migrate } = require('../schema');

const DEMO_PASSWORD = 'demo-password';
const DOMAIN = 'officepm.demo';

const USERS = [
  { name: 'Maya Okafor', admin: true },
  { name: 'Tunde Bakare' },
  { name: 'Priya Nair' },
  { name: 'Jonas Weber' },
  { name: 'Chloe Martin' },
  { name: 'Sam Adeyemi' }
];
const emailOf = (name) => name.toLowerCase().replace(' ', '.') + '@' + DOMAIN;
const MAYA = 'Maya Okafor', TUNDE = 'Tunde Bakare', PRIYA = 'Priya Nair',
  JONAS = 'Jonas Weber', CHLOE = 'Chloe Martin', SAM = 'Sam Adeyemi';

// ---- time helpers (UTC, SQLite "YYYY-MM-DD HH:MM:SS" and plain dates) ------

function stamp(daysAgo, hour = 10, minute = 0) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setUTCHours(hour, minute, 0, 0);
  const capped = d.getTime() > Date.now() ? new Date() : d;
  return capped.toISOString().replace('T', ' ').slice(0, 19);
}
function day(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

// ---- the demo content ------------------------------------------------------
// Each ticket: b = board ("project/board"), id = local handle, ep = epic handle,
// sp = sprint handle, due = days from today, ago = days since last update.

const TICKETS = [
  // Food / Engineering (scrum, points). Three epics first.
  { id: 'e1', b: 'food/eng', title: 'Group ordering', type: 'epic', level: 'epic', status: 'In Progress', who: MAYA, pri: 'high', labels: ['ordering'], ago: 2, made: 40,
    desc: 'Let a whole office build one shared order, with a cutoff, and split the bill fairly.' },
  { id: 'e2', b: 'food/eng', title: 'Payments and receipts', type: 'epic', level: 'epic', status: 'In Progress', who: TUNDE, pri: 'medium', labels: ['payments'], ago: 1, made: 40,
    desc: 'Take payment once, show the right total, and send a receipt people can expense.' },
  { id: 'e3', b: 'food/eng', title: 'Kitchen dashboard', type: 'epic', level: 'epic', status: 'Backlog', who: PRIYA, pri: 'low', labels: ['kitchen'], ago: 9, made: 40,
    desc: 'A screen for the kitchen that shows incoming orders in the order they are due.' },

  { id: 'a1', b: 'food/eng', title: 'Invite teammates to an order by link', type: 'story', level: 'story', status: 'Done', who: CHLOE, pts: 5, ep: 'e1', sp: 's12', ago: 26, made: 38, pri: 'medium', labels: ['ordering'],
    ac: ['A link opens the order without a login screen first', 'Links expire when the order closes'] },
  { id: 'a2', b: 'food/eng', title: 'Split bill by item', type: 'story', level: 'story', status: 'Done', who: JONAS, pts: 5, ep: 'e2', sp: 's13', ago: 15, made: 30, pri: 'high', labels: ['payments'],
    ac: ['Each person pays only for what they picked', 'Shared items are divided evenly'] },
  { id: 'a3', b: 'food/eng', title: 'Tip rounds down to zero on small orders', type: 'bug', level: 'bug', status: 'Done', who: TUNDE, pts: 2, ep: 'e2', sp: 's13', ago: 12, made: 20, pri: 'medium', labels: ['payments', 'bug'] },
  { id: 'a4', b: 'food/eng', title: 'Vendor menu import job', type: 'task', level: 'task', status: 'Done', who: SAM, pts: 5, ep: 'e3', sp: 's13', ago: 11, made: 24, pri: 'medium', labels: ['kitchen', 'infra'] },

  { id: 'a5', b: 'food/eng', title: 'Group order summary page', type: 'story', level: 'story', status: 'Code Review', who: MAYA, pts: 5, ep: 'e1', sp: 's14', ago: 1, made: 9, pri: 'high', labels: ['ordering', 'ui'], due: 3,
    desc: 'One page that shows who ordered what, the running total and the cutoff countdown.',
    ac: ['Shows every participant and their items', 'Total updates without a refresh', 'Countdown turns amber in the last 10 minutes'] },
  { id: 'a6', b: 'food/eng', title: 'Checkout total off by one cent with vouchers', type: 'bug', level: 'bug', status: 'In Progress', who: TUNDE, pts: 3, ep: 'e2', sp: 's14', ago: 0, made: 4, pri: 'urgent', labels: ['payments', 'bug'], due: 1,
    desc: 'A 15 percent voucher on three items rounds each line separately, so the total drifts.' },
  { id: 'a7', b: 'food/eng', title: 'Email a receipt after delivery', type: 'story', level: 'story', status: 'QA', who: PRIYA, pts: 3, ep: 'e2', sp: 's14', ago: 1, made: 8, pri: 'medium', labels: ['payments', 'email'], due: 2,
    ac: ['Receipt lists each item and the tip', 'Plain text version exists'] },
  { id: 'a8', b: 'food/eng', title: 'Kitchen ticket printer layout', type: 'task', level: 'task', status: 'In Progress', who: MAYA, pts: 5, ep: 'e3', sp: 's14', ago: 2, made: 8, pri: 'high', labels: ['kitchen'],
    blocked: 'Waiting on the printer SDK licence from the vendor' },
  { id: 'a9', b: 'food/eng', title: 'Rate limit the ordering API', type: 'task', level: 'task', status: 'Done', who: SAM, pts: 2, sp: 's14', ago: 4, made: 8, pri: 'medium', labels: ['infra'] },
  { id: 'a10', b: 'food/eng', title: 'Dietary tags on menu items', type: 'story', level: 'story', status: 'Done', who: CHLOE, pts: 3, sp: 's14', ago: 6, made: 9, pri: 'low', labels: ['ui', 'menu'] },
  { id: 'a11', b: 'food/eng', title: 'Allergen warning banner', type: 'story', level: 'story', status: 'Done', who: CHLOE, pts: 3, sp: 's14', ago: 2, made: 7, pri: 'high', labels: ['ui', 'menu'] },

  { id: 'a12', b: 'food/eng', title: 'Saved payment methods', type: 'story', level: 'story', status: 'Backlog', who: JONAS, pts: 8, ep: 'e2', ago: 5, made: 14, pri: 'medium', labels: ['payments'], due: 12 },
  { id: 'a13', b: 'food/eng', title: 'Order history filters', type: 'task', level: 'task', status: 'Backlog', who: null, pts: 3, ago: 7, made: 14, pri: 'low', labels: ['ui'] },

  // Food / Design (kanban, WIP limit 3 in progress)
  { id: 'd1', b: 'food/design', title: 'Redesign the order confirmation screen', type: 'task', status: 'In Progress', who: CHLOE, ago: 1, made: 6, pri: 'high', labels: ['ui'], due: 3 },
  { id: 'd2', b: 'food/design', title: 'Empty state illustrations for order history', type: 'asset', status: 'Backlog', who: null, ago: 8, made: 10, pri: 'low', labels: ['illustration'] },

  // Food / Support (scrumban)
  { id: 's1', b: 'food/support', title: 'Customer charged twice for one order', type: 'bug', status: 'In Progress', who: MAYA, ago: 0, made: 2, pri: 'urgent', labels: ['billing'], due: -1,
    desc: 'Provider shows two captures a few seconds apart. Looks like a double submit on a slow connection.' },
  { id: 's2', b: 'food/support', title: 'How do I change my delivery address?', type: 'ticket', status: 'Inbox', who: null, ago: 0, made: 0, pri: 'medium' },
  { id: 's3', b: 'food/support', title: 'Missing item in a group order', type: 'ticket', status: 'Waiting on Customer', who: JONAS, ago: 3, made: 5, pri: 'low', labels: ['group-order'] },

  // Northwind / Product (shape up)
  { id: 'p1', b: 'northwind/product', title: 'Reorder reminders', type: 'pitch', level: 'story', status: 'Building', who: PRIYA, appetite: '6 weeks', ago: 2, made: 20, pri: 'high', labels: ['retention'],
    desc: 'Nudge people who order the same lunch every week. Scoped to one reminder, no settings page.' },
  { id: 'p2', b: 'northwind/product', title: 'Gift cards', type: 'pitch', level: 'story', status: 'Bet', who: MAYA, appetite: '2 weeks', ago: 6, made: 12, pri: 'medium', labels: ['revenue'] },

  // Northwind / Marketing (kanban)
  { id: 'm1', b: 'northwind/marketing', title: 'Launch week email series', type: 'campaign', status: 'In Progress', who: SAM, ago: 1, made: 8, pri: 'high', labels: ['email'], due: 4 },
  { id: 'm2', b: 'northwind/marketing', title: 'Behind the scenes in the kitchen', type: 'post', status: 'Scheduled', who: CHLOE, ago: 2, made: 6, pri: 'low', labels: ['social'], due: 2 },

  // Acme / Engineering (waterfall)
  { id: 'x1', b: 'acme/eng', title: 'Supplier portal single sign-on', type: 'task', status: 'Implementation', who: TUNDE, ago: 1, made: 30, pri: 'high', labels: ['security'], due: 9 },
  { id: 'x2', b: 'acme/eng', title: 'Export invoices to CSV', type: 'change-request', status: 'Requirements', who: JONAS, ago: 4, made: 7, pri: 'medium', labels: ['finance'] },

  // Acme / QA (kanban)
  { id: 'q1', b: 'acme/qa', title: 'Verify SSO login on mobile Safari', type: 'test-case', status: 'In Progress', who: PRIYA, ago: 1, made: 3, pri: 'medium', labels: ['security'] },
  { id: 'q2', b: 'acme/qa', title: 'Invoice export drops the last row', type: 'bug', status: 'Failed', who: JONAS, ago: 0, made: 2, pri: 'high', labels: ['finance'], due: 2 }
];

const COMMENTS = [
  ['a5', PRIYA, 'Looks good. One nit on the empty state copy, it reads like an error.', 1, 15],
  ['a5', MAYA, 'Fair. Changed it to "Nobody has joined yet". Pushed.', 1, 17],
  ['a6', TUNDE, 'Reproduced with a 15 percent voucher on three items. Rounding happens per line instead of on the total.', 0, 9],
  ['a6', MAYA, 'Round the total once, not each line. Can you add a test with that voucher?', 0, 10],
  ['a7', PRIYA, 'Template renders everywhere I tried. Waiting on a QA pass for the dark mode email.', 1, 11],
  ['a8', MAYA, 'Vendor says the licence takes about a week. Parking this until it lands.', 2, 14],
  ['a1', CHLOE, 'Shipped behind a flag, turning it on for the Lagos office first.', 26, 12],
  ['s1', SAM, 'Confirmed in the payment provider dashboard. Refund issued, now looking at the double submit.', 0, 8],
  ['s1', MAYA, 'Disable the button on first tap, and make the capture idempotent on the order id.', 0, 9],
  ['q2', JONAS, 'Only the final row is dropped, and only when the export has exactly 100 lines.', 0, 10],
  ['p1', PRIYA, 'Week two. The reminder email is wired, the unsubscribe path is next.', 2, 16],
  ['x1', TUNDE, 'Identity provider metadata imported. Testing the logout redirect now.', 1, 13]
];

const DOD = {
  'food/eng': ['Code reviewed by another engineer', 'Unit tests pass', 'Deployed to staging', 'QA sign-off']
};

function run() {
  const ROOT = path.join(__dirname, '..');
  const DATA_DIR = process.env.PM_DATA_DIR ? path.resolve(process.env.PM_DATA_DIR) : ROOT;
  const PROJECTS_FILE = process.env.PM_PROJECTS_FILE
    ? path.resolve(process.env.PM_PROJECTS_FILE) : path.join(ROOT, 'projects.json');

  const config = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  const boards = {};
  for (const p of config.projects) for (const b of p.boards) boards[p.slug + '/' + b.slug] = { project: p, board: b };
  for (const t of TICKETS) {
    if (!boards[t.b]) {
      console.error('[seed] projects.json has no board "' + t.b + '". The demo content assumes the stock projects.json.');
      process.exit(1);
    }
    const { board } = boards[t.b];
    if (!board.statuses.includes(t.status) || !board.types.includes(t.type)) {
      console.error('[seed] "' + t.title + '" uses a status or type that board ' + t.b + ' does not declare.');
      process.exit(1);
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'pm.db'));
  db.pragma('journal_mode = WAL');
  migrate(db);

  const existing = db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
  if (existing > 0) {
    console.error('[seed] This database already has ' + existing + ' ticket(s). Refusing to seed over real data.');
    console.error('[seed] To try the demo, point PM_DATA_DIR at an empty directory.');
    db.close();
    process.exit(1);
  }

  const tx = db.transaction(() => {
    // Board settings and key counters, the same rows the server writes at boot.
    for (const { project, board } of Object.values(boards)) {
      db.prepare(`INSERT OR IGNORE INTO board_settings
        (project_slug, board_slug, flow, agile_enabled, wip_limits, definition_of_done, definition_of_ready)
        VALUES (?,?,?,?,?,?,?)`).run(project.slug, board.slug, board.flow, board.agile ? 1 : 0,
        JSON.stringify(board.wip_limits || {}), JSON.stringify(board.definition_of_done || []),
        JSON.stringify(board.definition_of_ready || []));
      db.prepare('INSERT OR IGNORE INTO counters (prefix, next) VALUES (?, 1)').run(board.prefix);
    }

    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    for (const u of USERS) {
      db.prepare('INSERT OR IGNORE INTO users (email, name, password, is_admin) VALUES (?,?,?,?)')
        .run(emailOf(u.name), u.name, hash, u.admin ? 1 : 0);
    }

    // Sprints: two completed on the engineering board, one active, so velocity
    // and the burndown both have something to draw. One completed cycle on Support.
    const sprint = {};
    const addSprint = (h, b, name, status, startOff, endOff, createdAgo) => {
      const { project, board } = boards[b];
      sprint[h] = crypto.randomUUID();
      db.prepare(`INSERT INTO sprints (id, project_slug, board_slug, name, kind, start_date, end_date, status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(sprint[h], project.slug, board.slug, name, 'sprint', day(startOff), day(endOff), status, stamp(createdAgo));
    };
    addSprint('s12', 'food/eng', 'Sprint 12', 'completed', -36, -23, 37);
    addSprint('s13', 'food/eng', 'Sprint 13', 'completed', -22, -9, 23);
    addSprint('s14', 'food/eng', 'Sprint 14', 'active', -8, 6, 9);

    const keyOf = {};
    const counters = {};
    const insert = db.prepare(`INSERT INTO tickets
      (project_slug, board_slug, key, title, type, status, assignee, parent_key, level, description,
       acceptance_criteria, points, appetite, sprint_id, blocked, blocker_reason, priority, labels, due_date,
       created_at, updated_at)
      VALUES (@project_slug,@board_slug,@key,@title,@type,@status,@assignee,@parent_key,@level,@description,
       @acceptance_criteria,@points,@appetite,@sprint_id,@blocked,@blocker_reason,@priority,@labels,@due_date,
       @created_at,@updated_at)`);

    for (const t of TICKETS) {
      const { project, board } = boards[t.b];
      counters[board.prefix] = (counters[board.prefix] || 0) + 1;
      const key = board.prefix + '-' + counters[board.prefix];
      keyOf[t.id] = key;
      insert.run({
        project_slug: project.slug, board_slug: board.slug, key, title: t.title, type: t.type, status: t.status,
        assignee: t.who ? emailOf(t.who) : null,
        parent_key: t.ep ? keyOf[t.ep] : null,
        level: board.agile ? (t.level || 'task') : null,
        description: t.desc || null,
        acceptance_criteria: board.agile ? JSON.stringify(t.ac || []) : null,
        points: board.points ? (t.pts ?? null) : null,
        appetite: t.appetite || null,
        sprint_id: t.sp ? sprint[t.sp] : null,
        blocked: t.blocked ? 1 : 0,
        blocker_reason: t.blocked || null,
        priority: t.pri || null,
        labels: t.labels ? JSON.stringify(t.labels) : null,
        due_date: t.due !== undefined ? day(t.due) : null,
        created_at: stamp(t.made, 9), updated_at: stamp(t.ago, 14)
      });
    }
    for (const [prefix, n] of Object.entries(counters)) {
      db.prepare('UPDATE counters SET next = ? WHERE prefix = ?').run(n + 1, prefix);
    }

    // Support gets one completed week so its velocity card has data.
    const sup = boards['food/support'];
    sprint.w41 = crypto.randomUUID();
    db.prepare(`INSERT INTO sprints (id, project_slug, board_slug, name, kind, start_date, end_date, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(sprint.w41, sup.project.slug, sup.board.slug, 'Week 41', 'sprint', day(-14), day(-8), 'completed', stamp(15));

    for (const [h, who, body, ago, hour] of COMMENTS) {
      db.prepare('INSERT INTO comments (ticket_key, author, body, source, created_at) VALUES (?,?,?,?,?)')
        .run(keyOf[h], who, body, 'user', stamp(ago, hour));
    }
    // A bot comment and its matching GitHub link, the way a PR opening writes them.
    db.prepare("INSERT INTO comments (ticket_key, author, body, source, created_at) VALUES (?, 'GitHub', ?, 'system', ?)")
      .run(keyOf.a5, 'PR opened: https://github.com/northwind/food-app/pull/212 by maya-okafor. Moved to "Code Review".', stamp(1, 13));
    db.prepare(`INSERT INTO github_links (id, ticket_key, kind, repo, ref, url, actor, environment, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), keyOf.a5, 'pr', 'northwind/food-app', 'feat/group-order-summary',
      'https://github.com/northwind/food-app/pull/212', 'maya-okafor', null, stamp(1, 13));

    // Definition of Done progress: finished work is fully ticked, review is half way.
    const dod = DOD['food/eng'];
    for (const t of TICKETS.filter((x) => x.b === 'food/eng' && x.level !== 'epic')) {
      const ticked = t.status === 'Done' ? 4 : t.status === 'QA' ? 3 : t.status === 'Code Review' ? 1 : 0;
      if (!ticked) continue;
      dod.forEach((item, i) => db.prepare('INSERT INTO ticket_dod (ticket_key, item, done) VALUES (?,?,?)')
        .run(keyOf[t.id], item, i < ticked ? 1 : 0));
    }

    // Reference links on the epics, and a couple of project docs.
    const link = db.prepare('INSERT INTO ticket_links (id, ticket_key, title, url, author, created_at) VALUES (?,?,?,?,?,?)');
    link.run(crypto.randomUUID(), keyOf.e1, 'Group ordering spec', 'https://example.com/specs/group-ordering', MAYA, stamp(38));
    link.run(crypto.randomUUID(), keyOf.e2, 'Payments flow diagram', 'https://example.com/specs/payments-flow', TUNDE, stamp(36));
    link.run(crypto.randomUUID(), keyOf.e3, 'Kitchen screen mockups', 'https://example.com/design/kitchen-screen', PRIYA, stamp(30));
    const doc = db.prepare('INSERT INTO project_docs (id, project_slug, title, kind, url, body, author, created_at) VALUES (?,?,?,?,?,?,?,?)');
    doc.run(crypto.randomUUID(), 'food', 'Ordering API reference', 'link', 'https://example.com/docs/ordering-api', 'Endpoints, auth and error codes.', TUNDE, stamp(30));
    doc.run(crypto.randomUUID(), 'food', 'Brand and tone guide', 'link', 'https://example.com/docs/brand', null, CHLOE, stamp(28));

    // One retro, created the way completing Sprint 13 would have created it.
    const retro = crypto.randomUUID();
    db.prepare('INSERT INTO retros (id, project_slug, board_slug, sprint_id, name, status, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(retro, 'food', 'eng', sprint.s13, 'Retro: Sprint 13', 'open', stamp(9, 16));
    const card = db.prepare('INSERT INTO retro_cards (id, retro_id, column_name, body, author, ticket_key, created_at) VALUES (?,?,?,?,?,?,?)');
    [['well', 'Pairing on the tip bug cut review time in half', TUNDE, keyOf.a3],
      ['well', 'The vendor menu import landed a day early', SAM, keyOf.a4],
      ['didnt', 'Two tickets were carried over without being re-estimated', PRIYA, null],
      ['didnt', 'Staging was down for most of a day', JONAS, null],
      ['actions', 'Re-estimate carried-over tickets at planning', MAYA, null],
      ['actions', 'Add a staging health check to the stand-up', SAM, null]
    ].forEach(([col, body, who, tk]) => card.run(crypto.randomUUID(), retro, col, body, who, tk, stamp(8, 11)));
  });
  tx();

  const n = db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
  db.close();
  console.log('[seed] Created ' + n + ' tickets, ' + USERS.length + ' users, 4 sprints and 1 retro in ' + path.join(DATA_DIR, 'pm.db'));
  console.log('[seed] Demo login: ' + emailOf(MAYA) + ' / ' + DEMO_PASSWORD);
}

if (require.main === module) run();
module.exports = { run, DEMO_PASSWORD, emailOf, MAYA };
