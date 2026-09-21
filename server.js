'use strict';
/**
 * OfficePM v1.0 - server.js
 * One Node process, one SQLite file. See README.md for the full picture.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const PM_TOKEN = process.env.PM_TOKEN || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@officepm.local';
// Section 12: no secrets in source. No hardcoded default password - if the operator
// doesn't set ADMIN_PASSWORD, generate a random one at first boot and print it once.
const ADMIN_PASSWORD_GENERATED = !process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');

const BLOCKED_EXTENSIONS = new Set(['.exe', '.sh', '.bat', '.cmd', '.js', '.html', '.htm']);
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_FILES_PER_TICKET = 20;
const MAX_FILES_PER_PROJECT = 100;
const SESSION_DAYS = 7;

// ---------------------------------------------------------------------------
// 1. Load + validate projects.json (section 15: refuse to start on bad data)
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error('[OfficePM] STARTUP FAILED: ' + msg);
  process.exit(1);
}

function loadProjectsConfig() {
  const configPath = path.join(ROOT, 'projects.json');
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    fail('cannot read projects.json at ' + configPath + ' (' + e.message + ')');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail('projects.json is not valid JSON: ' + e.message);
  }
  if (!parsed || !Array.isArray(parsed.projects)) {
    fail('projects.json must have a top-level "projects" array');
  }

  const seenProjectSlugs = new Set();
  const seenPrefixes = new Map(); // prefix -> "projectSlug/boardSlug"
  const VALID_FLOWS = new Set(['kanban', 'scrum', 'scrumban', 'shapeup', 'waterfall']);

  for (const project of parsed.projects) {
    if (!project.slug || typeof project.slug !== 'string' || !/^[a-z0-9-]+$/.test(project.slug)) {
      fail('every project needs a lowercase slug (a-z0-9-); offending project: ' + JSON.stringify(project.name || project));
    }
    if (seenProjectSlugs.has(project.slug)) fail('duplicate project slug: ' + project.slug);
    seenProjectSlugs.add(project.slug);
    if (!project.name) fail('project "' + project.slug + '" is missing name');
    if (!Array.isArray(project.boards) || project.boards.length === 0) {
      fail('project "' + project.slug + '" must have at least one board');
    }

    const seenBoardSlugs = new Set();
    for (const board of project.boards) {
      if (!board.slug || !/^[a-z0-9-]+$/.test(board.slug)) {
        fail('board in project "' + project.slug + '" needs a lowercase slug');
      }
      if (seenBoardSlugs.has(board.slug)) fail('duplicate board slug "' + board.slug + '" in project "' + project.slug + '"');
      seenBoardSlugs.add(board.slug);
      if (!board.prefix || !/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(board.prefix)) {
        fail('board "' + project.slug + '/' + board.slug + '" needs an uppercase prefix like FOOD-ENG');
      }
      if (seenPrefixes.has(board.prefix)) {
        fail('duplicate board prefix "' + board.prefix + '" used by both ' +
          seenPrefixes.get(board.prefix) + ' and ' + project.slug + '/' + board.slug +
          ' -- board prefixes must be globally unique (PRD 5, 15)');
      }
      seenPrefixes.set(board.prefix, project.slug + '/' + board.slug);
      if (!board.flow) board.flow = 'kanban';
      if (!VALID_FLOWS.has(board.flow)) {
        fail('board "' + project.slug + '/' + board.slug + '" has unknown flow "' + board.flow +
          '" (must be one of ' + Array.from(VALID_FLOWS).join(', ') + ')');
      }
      if (!Array.isArray(board.statuses) || board.statuses.length === 0) {
        fail('board "' + project.slug + '/' + board.slug + '" must declare a non-empty statuses array');
      }
      if (!Array.isArray(board.types) || board.types.length === 0) {
        fail('board "' + project.slug + '/' + board.slug + '" must declare a non-empty types array');
      }
      board.has_github = !!board.has_github;
      board.agile = !!board.agile;
      board.points = !!board.points;
      board.wip_limits = board.wip_limits || {};
      // Judgment call (PRD 6.11 / 17.6): "done" status = last entry in the statuses
      // array unless the board declares an explicit done_statuses override.
      board.done_statuses = Array.isArray(board.done_statuses) && board.done_statuses.length
        ? board.done_statuses
        : [board.statuses[board.statuses.length - 1]];
    }
  }

  console.log('[OfficePM] projects.json OK: ' + parsed.projects.length + ' project(s), ' +
    seenPrefixes.size + ' board(s), prefixes unique.');
  return parsed;
}

const PROJECTS_CONFIG = loadProjectsConfig();

function allBoards() {
  const out = [];
  for (const project of PROJECTS_CONFIG.projects) {
    for (const board of project.boards) out.push({ project, board });
  }
  return out;
}

function findBoard(projectSlug, boardSlug) {
  const project = PROJECTS_CONFIG.projects.find((p) => p.slug === projectSlug);
  if (!project) return null;
  const board = project.boards.find((b) => b.slug === boardSlug);
  if (!board) return null;
  return { project, board };
}

function findBoardByPrefix(prefix) {
  for (const { project, board } of allBoards()) {
    if (board.prefix === prefix) return { project, board };
  }
  return null;
}

const ALL_PREFIXES = allBoards().map(({ board }) => board.prefix);
// PRD 6.7 gives the regex [A-Z]+-\d+, which under-matches a key like FOOD-ENG-104
// (it would capture only "ENG-104"). Built the matcher from the real prefixes
// in projects.json instead so multi-segment prefixes match whole. Flagged in report.
function ticketKeyRegex() {
  const escaped = ALL_PREFIXES
    .slice()
    .sort((a, b) => b.length - a.length) // longest first, avoids partial-prefix matches
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('\\b(' + escaped.join('|') + ')-\\d+\\b', 'g');
}

// ---------------------------------------------------------------------------
// 2. Database (section 8, section 13 idempotent schema)
// ---------------------------------------------------------------------------

const UPLOADS_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(path.join(UPLOADS_DIR, 'projects'), { recursive: true });
fs.mkdirSync(path.join(UPLOADS_DIR, 'tickets'), { recursive: true });

const db = new Database(path.join(ROOT, 'pm.db'));
db.pragma('journal_mode = WAL'); // section 15: WAL mode mitigates SQLite corruption risk
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counters (
  prefix TEXT PRIMARY KEY,
  next INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT,
  qa_owner TEXT,
  parent_key TEXT,
  level TEXT,
  description TEXT,
  acceptance_criteria TEXT,
  points INTEGER,
  appetite TEXT,
  sprint_id TEXT,
  blocked INTEGER DEFAULT 0,
  blocker_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_board ON tickets(project_slug, board_slug);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee);
CREATE INDEX IF NOT EXISTS idx_tickets_sprint ON tickets(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_key);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_key);

CREATE TABLE IF NOT EXISTS github_links (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  repo TEXT NOT NULL,
  ref TEXT NOT NULL,
  url TEXT,
  actor TEXT,
  environment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_github_links_ticket ON github_links(ticket_key);

CREATE TABLE IF NOT EXISTS project_docs (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  body TEXT,
  author TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_links (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_files (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'planned',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retros (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  sprint_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retro_cards (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL,
  column_name TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  ticket_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS board_settings (
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  flow TEXT DEFAULT 'kanban',
  agile_enabled INTEGER DEFAULT 0,
  wip_limits TEXT,
  definition_of_done TEXT,
  definition_of_ready TEXT,
  PRIMARY KEY(project_slug, board_slug)
);

CREATE TABLE IF NOT EXISTS ticket_dod (
  ticket_key TEXT NOT NULL,
  item TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  PRIMARY KEY(ticket_key, item)
);
`);

// retro_cards.column is a reserved-ish word in the PRD's schema sketch (`column`);
// SQLite allows it quoted, but naming it column_name above avoids any ambiguity in
// hand-written SQL below. Judgment call, functionally identical.

// Idempotent board_settings seed / flow sync (section 13, 17.1: flow changes via
// projects.json + restart; agile flag likewise). Other settings (wip override,
// DoD/DoR) are runtime-editable via PATCH and are only defaulted, never clobbered.
const upsertBoardSettings = db.prepare(`
  INSERT INTO board_settings (project_slug, board_slug, flow, agile_enabled, wip_limits, definition_of_done, definition_of_ready)
  VALUES (@project_slug, @board_slug, @flow, @agile_enabled, @wip_limits, @dod, @dor)
  ON CONFLICT(project_slug, board_slug) DO UPDATE SET
    flow = excluded.flow,
    agile_enabled = excluded.agile_enabled
`);
const seedCounter = db.prepare(`INSERT OR IGNORE INTO counters (prefix, next) VALUES (?, 1)`);

const seedTx = db.transaction(() => {
  for (const { project, board } of allBoards()) {
    upsertBoardSettings.run({
      project_slug: project.slug,
      board_slug: board.slug,
      flow: board.flow,
      agile_enabled: board.agile ? 1 : 0,
      wip_limits: JSON.stringify(board.wip_limits || {}),
      dod: JSON.stringify(board.definition_of_done || []),
      dor: JSON.stringify(board.definition_of_ready || [])
    });
    seedCounter.run(board.prefix);
  }
});
seedTx();

// Admin bootstrap (section 6.12: no self-signup; someone has to exist first)
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO users (email, name, password, is_admin) VALUES (?, ?, ?, 1)')
    .run(ADMIN_EMAIL, 'Admin', hash);
  if (ADMIN_PASSWORD_GENERATED) {
    console.log('[OfficePM] Bootstrapped first admin user: ' + ADMIN_EMAIL);
    console.log('[OfficePM] Generated admin password (shown once, not stored anywhere in plaintext): ' + ADMIN_PASSWORD);
    console.log('[OfficePM] Log in and change it, or set ADMIN_EMAIL/ADMIN_PASSWORD env vars before first boot next time.');
  } else {
    console.log('[OfficePM] Bootstrapped first admin user: ' + ADMIN_EMAIL + ' (password from ADMIN_PASSWORD env var)');
  }
}

// Cleanup expired sessions hourly (section 12)
function cleanupSessions() {
  const n = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run().changes;
  if (n) console.log('[OfficePM] cleaned up ' + n + ' expired session(s)');
}
cleanupSessions();
setInterval(cleanupSessions, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// 3. SSE broadcast
// ---------------------------------------------------------------------------

const sseClients = new Set();
function broadcast(event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { /* client gone, heartbeat will reap it */ }
  }
}
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': heartbeat\n\n'); } catch (e) { /* ignore */ }
  }
}, 25000).unref();

// ---------------------------------------------------------------------------
// 4. Express app
// ---------------------------------------------------------------------------

const app = express();
app.set('trust proxy', 'loopback'); // Tailscale terminates TLS and forwards plain HTTP locally
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

function isSecureRequest(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function requireAuth(req, res, next) {
  const sid = req.cookies && req.cookies.pm_session;
  if (!sid) return res.status(401).json({ error: 'not authenticated' });
  const row = db.prepare(
    "SELECT sessions.user_id AS user_id, users.email AS email, users.name AS name, users.is_admin AS is_admin " +
    "FROM sessions JOIN users ON users.id = sessions.user_id " +
    "WHERE sessions.id = ? AND sessions.expires_at > datetime('now')"
  ).get(sid);
  if (!row) return res.status(401).json({ error: 'session expired' });
  req.user = { id: row.user_id, email: row.email, name: row.name, isAdmin: !!row.is_admin };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'admin only' });
  next();
}

function requireGithubToken(req, res, next) {
  if (!PM_TOKEN) return res.status(500).json({ error: 'PM_TOKEN not configured on server' });
  const token = req.get('x-pm-token');
  if (!token || token !== PM_TOKEN) return res.status(401).json({ error: 'invalid or missing x-pm-token' });
  next();
}

// ---------------------------------------------------------------------------
// 5. Auth routes (6.1)
// ---------------------------------------------------------------------------

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const sid = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sid, user.id, expires.toISOString());
  res.cookie('pm_session', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    expires
  });
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin });
});

app.post('/api/logout', (req, res) => {
  const sid = req.cookies && req.cookies.pm_session;
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  res.clearCookie('pm_session');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

// ---------------------------------------------------------------------------
// 6. Projects & boards (6.2, 6.3)
// ---------------------------------------------------------------------------

function boardCountsFor(project, board) {
  // Judgment call (PRD 6.11 doesn't define "Open" vs "In Progress"): the
  // first status in the array is "not started yet" (Open), the declared
  // done_statuses are "Done", everything else is "In Progress".
  const total = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE project_slug=? AND board_slug=?')
    .get(project.slug, board.slug).n;
  const done = db.prepare(
    'SELECT COUNT(*) AS n FROM tickets WHERE project_slug=? AND board_slug=? AND status IN (' +
    board.done_statuses.map(() => '?').join(',') + ')'
  ).get(project.slug, board.slug, ...board.done_statuses).n;
  const open = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE project_slug=? AND board_slug=? AND status = ?')
    .get(project.slug, board.slug, board.statuses[0]).n;
  const inProgress = total - done - open;
  return { total, done, open, inProgress };
}

function publicBoard(project, board) {
  return {
    slug: board.slug, name: board.name, prefix: board.prefix, icon: board.icon || 'layout',
    flow: board.flow, statuses: board.statuses, types: board.types,
    points: !!board.points, has_github: !!board.has_github, agile: !!board.agile,
    wip_limits: board.wip_limits || {}, done_statuses: board.done_statuses
  };
}

app.get('/api/projects', requireAuth, (req, res) => {
  res.json(PROJECTS_CONFIG.projects.map((p) => ({
    slug: p.slug, name: p.name, description: p.description || '',
    boards: p.boards.map((b) => publicBoard(p, b))
  })));
});

app.get('/api/projects/:slug', requireAuth, (req, res) => {
  const project = PROJECTS_CONFIG.projects.find((p) => p.slug === req.params.slug);
  if (!project) return res.status(404).json({ error: 'project not found' });
  res.json({
    slug: project.slug, name: project.name, description: project.description || '',
    boards: project.boards.map((b) => publicBoard(project, b))
  });
});

app.get('/api/projects/:slug/boards/:board', requireAuth, (req, res) => {
  const found = findBoard(req.params.slug, req.params.board);
  if (!found) return res.status(404).json({ error: 'board not found' });
  res.json(publicBoard(found.project, found.board));
});

app.get('/api/projects/:slug/boards/:board/settings', requireAuth, (req, res) => {
  const found = findBoard(req.params.slug, req.params.board);
  if (!found) return res.status(404).json({ error: 'board not found' });
  const row = db.prepare('SELECT * FROM board_settings WHERE project_slug=? AND board_slug=?')
    .get(req.params.slug, req.params.board);
  if (!row) return res.status(404).json({ error: 'board settings not found' });
  res.json({
    flow: row.flow, agile_enabled: !!row.agile_enabled,
    wip_limits: JSON.parse(row.wip_limits || '{}'),
    definition_of_done: JSON.parse(row.definition_of_done || '[]'),
    definition_of_ready: JSON.parse(row.definition_of_ready || '[]')
  });
});

app.patch('/api/projects/:slug/boards/:board/settings', requireAuth, requireAdmin, (req, res) => {
  const found = findBoard(req.params.slug, req.params.board);
  if (!found) return res.status(404).json({ error: 'board not found' });
  const existing = db.prepare('SELECT * FROM board_settings WHERE project_slug=? AND board_slug=?')
    .get(req.params.slug, req.params.board);
  const body = req.body || {};
  const wip = body.wip_limits !== undefined ? JSON.stringify(body.wip_limits) : existing.wip_limits;
  const dod = body.definition_of_done !== undefined ? JSON.stringify(body.definition_of_done) : existing.definition_of_done;
  const dor = body.definition_of_ready !== undefined ? JSON.stringify(body.definition_of_ready) : existing.definition_of_ready;
  db.prepare('UPDATE board_settings SET wip_limits=?, definition_of_done=?, definition_of_ready=? WHERE project_slug=? AND board_slug=?')
    .run(wip, dod, dor, req.params.slug, req.params.board);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 7. Tickets (6.4, 9)
// ---------------------------------------------------------------------------

function serializeTicket(row) {
  return Object.assign({}, row, {
    acceptance_criteria: row.acceptance_criteria ? JSON.parse(row.acceptance_criteria) : [],
    blocked: !!row.blocked
  });
}

function nextTicketKey(prefix) {
  // Counter table, not MAX(N)+1: survives ticket deletion without reusing a key
  // that old comments/links/GitHub events already point to.
  const row = db.prepare('SELECT next FROM counters WHERE prefix = ?').get(prefix);
  const n = row ? row.next : 1;
  db.prepare('INSERT INTO counters (prefix, next) VALUES (?, ?) ON CONFLICT(prefix) DO UPDATE SET next = ?')
    .run(prefix, n + 1, n + 1);
  return prefix + '-' + n;
}

app.get('/api/tickets', requireAuth, (req, res) => {
  const { project, board, assignee, mine } = req.query;
  let sql = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];
  if (project) { sql += ' AND project_slug = ?'; params.push(project); }
  if (board) { sql += ' AND board_slug = ?'; params.push(board); }
  if (assignee) { sql += ' AND assignee = ?'; params.push(assignee); }
  if (mine === '1' || mine === 'true') { sql += ' AND assignee = ?'; params.push(req.user.email); }
  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(serializeTicket));
});

app.post('/api/tickets', requireAuth, (req, res) => {
  const b = req.body || {};
  const found = findBoard(b.project_slug, b.board_slug);
  if (!found) return res.status(400).json({ error: 'unknown project/board' });
  const { board } = found;
  if (!b.title) return res.status(400).json({ error: 'title required' });
  if (!board.types.includes(b.type)) return res.status(400).json({ error: 'type must be one of: ' + board.types.join(', ') });
  const status = b.status && board.statuses.includes(b.status) ? b.status : board.statuses[0];

  const key = nextTicketKey(board.prefix);
  const stmt = db.prepare(`INSERT INTO tickets
    (project_slug, board_slug, key, title, type, status, assignee, qa_owner, parent_key, level,
     description, acceptance_criteria, points, appetite, sprint_id, blocked, blocker_reason)
    VALUES (@project_slug,@board_slug,@key,@title,@type,@status,@assignee,@qa_owner,@parent_key,@level,
     @description,@acceptance_criteria,@points,@appetite,@sprint_id,@blocked,@blocker_reason)`);
  stmt.run({
    project_slug: found.project.slug, board_slug: board.slug, key, title: b.title, type: b.type, status,
    assignee: b.assignee || null, qa_owner: b.qa_owner || null, parent_key: b.parent_key || null,
    level: board.agile ? (b.level || 'task') : null,
    description: b.description || null,
    acceptance_criteria: board.agile ? JSON.stringify(b.acceptance_criteria || []) : null,
    points: board.points ? (b.points ?? null) : null,
    appetite: board.flow === 'shapeup' ? (b.appetite || null) : null,
    sprint_id: b.sprint_id || null,
    blocked: board.agile && b.blocked ? 1 : 0,
    blocker_reason: b.blocker_reason || null
  });
  const ticket = serializeTicket(db.prepare('SELECT * FROM tickets WHERE key = ?').get(key));
  broadcast('ticket.created', ticket);
  res.status(201).json(ticket);
});

app.get('/api/tickets/:key', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM tickets WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'ticket not found' });
  res.json(serializeTicket(row));
});

const TICKET_PATCHABLE = new Set([
  'title', 'type', 'status', 'assignee', 'qa_owner', 'parent_key', 'level', 'description',
  'acceptance_criteria', 'points', 'appetite', 'sprint_id', 'blocked', 'blocker_reason'
]);

app.patch('/api/tickets/:key', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'ticket not found' });
  const found = findBoard(existing.project_slug, existing.board_slug);
  const body = req.body || {};
  const sets = [];
  const params = {};
  for (const field of Object.keys(body)) {
    if (!TICKET_PATCHABLE.has(field)) continue;
    if (field === 'status' && found && !found.board.statuses.includes(body.status)) {
      return res.status(400).json({ error: 'status must be one of: ' + found.board.statuses.join(', ') });
    }
    // 17 open question 4, default: Waterfall phases do NOT allow parallel work,
    // sequential only. Enforced here as "can't skip a phase going forward";
    // moving backward (a regression) is always allowed, that's fixing the
    // sequence, not parallelizing it.
    if (field === 'status' && found && found.board.flow === 'waterfall' && body.status !== existing.status) {
      const oldIdx = found.board.statuses.indexOf(existing.status);
      const newIdx = found.board.statuses.indexOf(body.status);
      if (newIdx > oldIdx + 1) {
        return res.status(409).json({
          error: 'Waterfall boards are sequential only (PRD 17.4): move through "' +
            found.board.statuses[oldIdx + 1] + '" first, this board does not allow skipping ahead to "' + body.status + '"'
        });
      }
    }
    if (field === 'type' && found && !found.board.types.includes(body.type)) {
      return res.status(400).json({ error: 'type must be one of: ' + found.board.types.join(', ') });
    }
    sets.push(field + ' = @' + field);
    params[field] = field === 'acceptance_criteria' ? JSON.stringify(body[field] || []) :
      field === 'blocked' ? (body[field] ? 1 : 0) : body[field];
  }
  if (!sets.length) return res.status(400).json({ error: 'no patchable fields provided' });
  sets.push("updated_at = datetime('now')");
  params.key = req.params.key;
  db.prepare('UPDATE tickets SET ' + sets.join(', ') + ' WHERE key = @key').run(params);
  const ticket = serializeTicket(db.prepare('SELECT * FROM tickets WHERE key = ?').get(req.params.key));
  broadcast('ticket.updated', ticket);
  res.json(ticket);
});

app.delete('/api/tickets/:key', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'ticket not found' });
  const tx = db.transaction(() => {
    // Cascade: comments/links/github events removed, files unlinked from disk,
    // children's parent_key cleared rather than cascading deletes further.
    const files = db.prepare('SELECT stored_path FROM ticket_files WHERE ticket_key = ?').all(req.params.key);
    for (const f of files) {
      try { fs.unlinkSync(f.stored_path); } catch (e) { /* already gone */ }
    }
    db.prepare('DELETE FROM ticket_files WHERE ticket_key = ?').run(req.params.key);
    db.prepare('DELETE FROM ticket_links WHERE ticket_key = ?').run(req.params.key);
    db.prepare('DELETE FROM comments WHERE ticket_key = ?').run(req.params.key);
    db.prepare('DELETE FROM github_links WHERE ticket_key = ?').run(req.params.key);
    db.prepare('DELETE FROM ticket_dod WHERE ticket_key = ?').run(req.params.key);
    db.prepare('UPDATE tickets SET parent_key = NULL WHERE parent_key = ?').run(req.params.key);
    db.prepare('DELETE FROM tickets WHERE key = ?').run(req.params.key);
  });
  tx();
  broadcast('ticket.deleted', { key: req.params.key });
  res.json({ ok: true });
});

// Section 9's API list omits a route for ticket_dod even though 8.4 defines the
// table and 6.9 requires "Definition of Done (board-level checklist on every
// ticket)". Added the obvious two routes so the feature actually persists;
// judgment call, flagged in the report.
app.get('/api/tickets/:key/dod', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE key = ?').get(req.params.key);
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });
  const found = findBoard(ticket.project_slug, ticket.board_slug);
  const settings = db.prepare('SELECT definition_of_done FROM board_settings WHERE project_slug=? AND board_slug=?')
    .get(ticket.project_slug, ticket.board_slug);
  const items = JSON.parse((settings && settings.definition_of_done) || '[]');
  const state = db.prepare('SELECT item, done FROM ticket_dod WHERE ticket_key = ?').all(req.params.key);
  const doneMap = Object.fromEntries(state.map((r) => [r.item, !!r.done]));
  res.json(items.map((item) => ({ item, done: !!doneMap[item] })));
});

app.patch('/api/tickets/:key/dod', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT key FROM tickets WHERE key = ?').get(req.params.key);
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });
  const { item, done } = req.body || {};
  if (!item) return res.status(400).json({ error: 'item required' });
  db.prepare(`INSERT INTO ticket_dod (ticket_key, item, done) VALUES (?, ?, ?)
    ON CONFLICT(ticket_key, item) DO UPDATE SET done = excluded.done`)
    .run(req.params.key, item, done ? 1 : 0);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 8. Comments (6.5)
// ---------------------------------------------------------------------------

// Same omission as ticket_dod: section 9 lists no read route for github_links
// even though 8.1 defines the table and 10.5 says the drawer needs a "GitHub
// panel if board has has_github". Added the obvious GET, judgment call.
app.get('/api/tickets/:key/github', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM github_links WHERE ticket_key = ? ORDER BY created_at DESC').all(req.params.key));
});

app.get('/api/tickets/:key/comments', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM comments WHERE ticket_key = ? ORDER BY created_at ASC').all(req.params.key));
});

app.post('/api/tickets/:key/comments', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT key FROM tickets WHERE key = ?').get(req.params.key);
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });
  const body = (req.body || {}).body;
  if (!body) return res.status(400).json({ error: 'body required' });
  const info = db.prepare("INSERT INTO comments (ticket_key, author, body, source) VALUES (?, ?, ?, 'user')")
    .run(req.params.key, req.user.name, body);
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  broadcast('comment.created', comment);
  res.status(201).json(comment);
});

function addSystemComment(ticketKey, body) {
  const info = db.prepare("INSERT INTO comments (ticket_key, author, body, source) VALUES (?, 'GitHub', ?, 'system')")
    .run(ticketKey, body);
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  broadcast('comment.created', comment);
  return comment;
}

// ---------------------------------------------------------------------------
// 9. Sprints/Cycles/Phases (6.10, 9)
// ---------------------------------------------------------------------------

app.get('/api/projects/:slug/boards/:board/sprints', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM sprints WHERE project_slug=? AND board_slug=? ORDER BY created_at DESC')
    .all(req.params.slug, req.params.board));
});

app.post('/api/projects/:slug/boards/:board/sprints', requireAuth, (req, res) => {
  const found = findBoard(req.params.slug, req.params.board);
  if (!found) return res.status(400).json({ error: 'unknown project/board' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const kind = b.kind || (found.board.flow === 'shapeup' ? 'cycle' : found.board.flow === 'waterfall' ? 'phase' : 'sprint');
  if (b.status === 'active') {
    const already = db.prepare("SELECT id FROM sprints WHERE project_slug=? AND board_slug=? AND status='active'")
      .get(req.params.slug, req.params.board);
    if (already) return res.status(409).json({ error: 'another sprint/cycle is already active on this board' });
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO sprints (id, project_slug, board_slug, name, kind, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.params.slug, req.params.board, b.name, kind, b.start_date || null, b.end_date || null, b.status || 'planned');
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(id);
  broadcast('sprint.created', sprint);
  res.status(201).json(sprint);
});

app.patch('/api/sprints/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'sprint not found' });
  const b = req.body || {};
  if (b.status === 'active' && existing.status !== 'active') {
    const already = db.prepare("SELECT id FROM sprints WHERE project_slug=? AND board_slug=? AND status='active' AND id != ?")
      .get(existing.project_slug, existing.board_slug, req.params.id);
    if (already) return res.status(409).json({ error: 'another sprint/cycle is already active on this board' });
  }
  const name = b.name ?? existing.name;
  const start_date = b.start_date ?? existing.start_date;
  const end_date = b.end_date ?? existing.end_date;
  const status = b.status ?? existing.status;
  db.prepare('UPDATE sprints SET name=?, start_date=?, end_date=?, status=? WHERE id=?')
    .run(name, start_date, end_date, status, req.params.id);
  // Sprint completion auto-creates a retro (6.9/6.10), once.
  if (status === 'completed' && existing.status !== 'completed') {
    const already = db.prepare('SELECT id FROM retros WHERE sprint_id = ?').get(req.params.id);
    if (!already) {
      const retroId = crypto.randomUUID();
      db.prepare('INSERT INTO retros (id, project_slug, board_slug, sprint_id, name) VALUES (?, ?, ?, ?, ?)')
        .run(retroId, existing.project_slug, existing.board_slug, req.params.id, existing.name + ' Retro');
    }
  }
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  broadcast('sprint.updated', sprint);
  res.json(sprint);
});

app.delete('/api/sprints/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sprints WHERE id = ?').run(req.params.id);
  broadcast('sprint.deleted', { id: req.params.id });
  res.json({ ok: true });
});

// Burndown chart data (6.9: "burndown chart (inline SVG per sprint)"). Not in
// section 9's route list, same class of omission as ticket_dod/github_links.
// Judgment call on the shape of the data, spelled out here because there's no
// daily-snapshot table in the schema (8.3's sprints table has no history):
// "actual remaining" per day is approximated from each ticket's updated_at as
// a stand-in for "the day it was marked done" - the real transition time
// isn't tracked, only the last update. Good enough for a v1 inline SVG, not
// audit-grade. "ideal" is a straight line from full scope at start_date to
// zero at end_date. Scope is points if the board has points enabled, else a
// ticket count.
app.get('/api/sprints/:id/burndown', requireAuth, (req, res) => {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!sprint) return res.status(404).json({ error: 'sprint not found' });
  const found = findBoard(sprint.project_slug, sprint.board_slug);
  if (!found) return res.status(404).json({ error: 'board not found' });
  const usePoints = !!found.board.points;
  const tickets = db.prepare('SELECT * FROM tickets WHERE sprint_id = ?').all(sprint.id);
  const scopeOf = (t) => (usePoints ? (t.points || 0) : 1);
  const totalScope = tickets.reduce((sum, t) => sum + scopeOf(t), 0);

  if (!sprint.start_date || !sprint.end_date) {
    return res.json({ sprint_id: sprint.id, uses_points: usePoints, total_scope: totalScope, points: [], insufficient_dates: true });
  }

  const start = new Date(sprint.start_date + 'T00:00:00Z');
  const end = new Date(sprint.end_date + 'T00:00:00Z');
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const plotEnd = sprint.status === 'completed' ? end : (today < end ? end : today);
  const totalDays = Math.max(1, Math.round((end - start) / 86400000));

  const points = [];
  for (let d = new Date(start); d <= plotEnd; d = new Date(d.getTime() + 86400000)) {
    const dayIso = d.toISOString().slice(0, 10);
    const elapsed = Math.round((d - start) / 86400000);
    const ideal = d > end ? 0 : Math.max(0, Math.round(totalScope * (1 - elapsed / totalDays)));
    const doneByThisDay = tickets.filter((t) =>
      found.board.done_statuses.includes(t.status) && t.updated_at && t.updated_at.slice(0, 10) <= dayIso
    );
    const remaining = totalScope - doneByThisDay.reduce((sum, t) => sum + scopeOf(t), 0);
    const actual = d <= today ? Math.max(0, remaining) : null;
    points.push({ date: dayIso, ideal, actual });
  }
  res.json({ sprint_id: sprint.id, uses_points: usePoints, total_scope: totalScope, points, insufficient_dates: false });
});

// Scrumban velocity (17 open question 3, default yes): average scope
// completed per COMPLETED sprint/cycle on this board. Points if the board
// tracks them, else ticket count. Boards with fewer than one completed
// sprint report velocity: null rather than 0, so the UI can say "not enough
// data yet" instead of implying zero throughput.
app.get('/api/projects/:slug/boards/:board/velocity', requireAuth, (req, res) => {
  const found = findBoard(req.params.slug, req.params.board);
  if (!found) return res.status(404).json({ error: 'board not found' });
  const usePoints = !!found.board.points;
  const completedSprints = db.prepare(
    "SELECT * FROM sprints WHERE project_slug=? AND board_slug=? AND status='completed'"
  ).all(req.params.slug, req.params.board);
  const perSprint = completedSprints.map((s) => {
    const tickets = db.prepare('SELECT * FROM tickets WHERE sprint_id = ?').all(s.id);
    const done = tickets.filter((t) => found.board.done_statuses.includes(t.status));
    const scope = done.reduce((sum, t) => sum + (usePoints ? (t.points || 0) : 1), 0);
    return { sprint_id: s.id, name: s.name, completed_scope: scope };
  });
  const average = perSprint.length
    ? Math.round((perSprint.reduce((sum, s) => sum + s.completed_scope, 0) / perSprint.length) * 10) / 10
    : null;
  res.json({ uses_points: usePoints, sprints: perSprint, average_velocity: average });
});

// ---------------------------------------------------------------------------
// 10. Docs / Files / Links (6.6)
// ---------------------------------------------------------------------------

// Normalizes an original filename's extension defensively before comparing
// against the blocklist: strips a null byte and anything after it (Node
// strings can carry one from a crafted multipart header), then trims
// trailing whitespace/dots, which is how "evil.exe " or "evil.exe." would
// otherwise slip past a naive path.extname() + Set.has() check.
function safeExt(originalName) {
  const nullIdx = originalName.indexOf('\u0000');
  let clean = nullIdx === -1 ? originalName : originalName.slice(0, nullIdx);
  // Strip trailing whitespace/dots from the WHOLE name before asking extname
  // for the extension - path.extname('evil.exe.') returns just '.' (Node
  // treats a trailing dot as "no extension"), which would otherwise let
  // "evil.exe." or "evil.exe " sail past a naive .toLowerCase() === '.exe'
  // check while still landing on disk with an executable-looking name.
  clean = clean.replace(/[\s.]+$/, '');
  return path.extname(clean).toLowerCase();
}

function fileFilterFactory() {
  return (req, file, cb) => {
    const ext = safeExt(file.originalname);
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new Error('file type ' + ext + ' is not allowed'));
    }
    cb(null, true);
  };
}

// Belt-and-braces: after building a path, assert it is still inside uploads/.
function assertInsideUploads(p) {
  const resolved = path.resolve(p);
  const base = path.resolve(UPLOADS_DIR) + path.sep;
  if (!resolved.startsWith(base)) {
    throw new Error('resolved path escapes uploads/: ' + resolved);
  }
  return resolved;
}

function uploadTo(dir) {
  const safeDir = assertInsideUploads(dir);
  fs.mkdirSync(safeDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, safeDir),
      // Path traversal prevented: stored filenames are UUIDs, never the client-supplied name.
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname))
    }),
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: fileFilterFactory()
  });
}

function handleUploadError(err, req, res, next) {
  if (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'file exceeds 25MB limit' : err.message;
    return res.status(400).json({ error: msg });
  }
  next();
}

app.get('/api/projects/:slug/docs', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM project_docs WHERE project_slug = ? ORDER BY created_at DESC').all(req.params.slug));
});

app.post('/api/projects/:slug/docs', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.kind) return res.status(400).json({ error: 'title and kind required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO project_docs (id, project_slug, title, kind, url, body, author) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.params.slug, b.title, b.kind, b.url || null, b.body || null, req.user.name);
  res.status(201).json(db.prepare('SELECT * FROM project_docs WHERE id = ?').get(id));
});

app.delete('/api/projects/:slug/docs/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM project_docs WHERE id = ? AND project_slug = ?').run(req.params.id, req.params.slug);
  res.json({ ok: true });
});

app.get('/api/projects/:slug/files', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, project_slug, original_name, size_bytes, mime_type, uploaded_by, created_at FROM project_files WHERE project_slug = ? ORDER BY created_at DESC').all(req.params.slug));
});

app.post('/api/projects/:slug/files', requireAuth, (req, res, next) => {
  // Path traversal fix: the directory segment comes from req.params.slug, which
  // Express URL-decodes before this handler runs. Validate against the slug
  // allow-list from projects.json (already loaded at startup, PRD 5/6.2) rather
  // than trying to sanitise the string - an unknown slug is a 404, not a path.
  if (!PROJECTS_CONFIG.projects.some((p) => p.slug === req.params.slug)) {
    return res.status(404).json({ error: 'project not found' });
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM project_files WHERE project_slug = ?').get(req.params.slug).n;
  if (count >= MAX_FILES_PER_PROJECT) return res.status(400).json({ error: 'project already has the maximum of ' + MAX_FILES_PER_PROJECT + ' files' });
  const dir = path.join(UPLOADS_DIR, 'projects', req.params.slug);
  const upload = uploadTo(dir).single('file');
  upload(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO project_files (id, project_slug, original_name, stored_path, size_bytes, mime_type, uploaded_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.params.slug, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.user.name);
    res.status(201).json(db.prepare('SELECT id, project_slug, original_name, size_bytes, mime_type, uploaded_by, created_at FROM project_files WHERE id = ?').get(id));
  });
});

app.get('/api/projects/:slug/files/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM project_files WHERE id = ? AND project_slug = ?').get(req.params.id, req.params.slug);
  if (!f) return res.status(404).json({ error: 'file not found' });
  res.download(f.stored_path, f.original_name); // always attachment, never inline (section 12)
});

app.delete('/api/projects/:slug/files/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM project_files WHERE id = ? AND project_slug = ?').get(req.params.id, req.params.slug);
  if (f) { try { fs.unlinkSync(f.stored_path); } catch (e) {} }
  db.prepare('DELETE FROM project_files WHERE id = ? AND project_slug = ?').run(req.params.id, req.params.slug);
  res.json({ ok: true });
});

app.get('/api/tickets/:key/links', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM ticket_links WHERE ticket_key = ? ORDER BY created_at DESC').all(req.params.key));
});

app.post('/api/tickets/:key/links', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.url) return res.status(400).json({ error: 'title and url required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO ticket_links (id, ticket_key, title, url, author) VALUES (?,?,?,?,?)')
    .run(id, req.params.key, b.title, b.url, req.user.name);
  res.status(201).json(db.prepare('SELECT * FROM ticket_links WHERE id = ?').get(id));
});

app.delete('/api/tickets/:key/links/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM ticket_links WHERE id = ? AND ticket_key = ?').run(req.params.id, req.params.key);
  res.json({ ok: true });
});

app.get('/api/tickets/:key/files', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, ticket_key, original_name, size_bytes, mime_type, uploaded_by, created_at FROM ticket_files WHERE ticket_key = ? ORDER BY created_at DESC').all(req.params.key));
});

app.post('/api/tickets/:key/files', requireAuth, (req, res, next) => {
  // Path traversal fix: key must match the real ticket-key shape AND exist in
  // the tickets table (PRD 5: every ticket belongs to exactly one board, keys
  // are <PREFIX>-<NUMBER>). Both together are the allow-list; a key that
  // parses but doesn't exist, or doesn't parse at all, is a 404.
  if (!/^[A-Z0-9]+(-[A-Z0-9]+)*-\d+$/.test(req.params.key)) {
    return res.status(404).json({ error: 'ticket not found' });
  }
  if (!db.prepare('SELECT 1 FROM tickets WHERE key = ?').get(req.params.key)) {
    return res.status(404).json({ error: 'ticket not found' });
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM ticket_files WHERE ticket_key = ?').get(req.params.key).n;
  if (count >= MAX_FILES_PER_TICKET) return res.status(400).json({ error: 'ticket already has the maximum of ' + MAX_FILES_PER_TICKET + ' files' });
  const dir = path.join(UPLOADS_DIR, 'tickets', req.params.key);
  const upload = uploadTo(dir).single('file');
  upload(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO ticket_files (id, ticket_key, original_name, stored_path, size_bytes, mime_type, uploaded_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.params.key, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.user.name);
    res.status(201).json(db.prepare('SELECT id, ticket_key, original_name, size_bytes, mime_type, uploaded_by, created_at FROM ticket_files WHERE id = ?').get(id));
  });
});

app.get('/api/tickets/:key/files/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ? AND ticket_key = ?').get(req.params.id, req.params.key);
  if (!f) return res.status(404).json({ error: 'file not found' });
  res.download(f.stored_path, f.original_name);
});

app.delete('/api/tickets/:key/files/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ? AND ticket_key = ?').get(req.params.id, req.params.key);
  if (f) { try { fs.unlinkSync(f.stored_path); } catch (e) {} }
  db.prepare('DELETE FROM ticket_files WHERE id = ? AND ticket_key = ?').run(req.params.id, req.params.key);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 11. Retros (6.9, 6.10)
// ---------------------------------------------------------------------------

app.get('/api/projects/:slug/boards/:board/retros', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM retros WHERE project_slug=? AND board_slug=? ORDER BY created_at DESC')
    .all(req.params.slug, req.params.board));
});

app.post('/api/projects/:slug/boards/:board/retros', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO retros (id, project_slug, board_slug, sprint_id, name) VALUES (?,?,?,?,?)')
    .run(id, req.params.slug, req.params.board, b.sprint_id || null, b.name);
  res.status(201).json(db.prepare('SELECT * FROM retros WHERE id = ?').get(id));
});

app.get('/api/retros/:id', requireAuth, (req, res) => {
  const retro = db.prepare('SELECT * FROM retros WHERE id = ?').get(req.params.id);
  if (!retro) return res.status(404).json({ error: 'retro not found' });
  const cards = db.prepare('SELECT * FROM retro_cards WHERE retro_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(Object.assign({}, retro, { cards }));
});

app.post('/api/retros/:id/cards', requireAuth, (req, res) => {
  const retro = db.prepare('SELECT * FROM retros WHERE id = ?').get(req.params.id);
  if (!retro) return res.status(404).json({ error: 'retro not found' });
  const b = req.body || {};
  if (!['well', 'didnt', 'actions'].includes(b.column)) return res.status(400).json({ error: 'column must be well, didnt or actions' });
  if (!b.body) return res.status(400).json({ error: 'body required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO retro_cards (id, retro_id, column_name, body, author, ticket_key) VALUES (?,?,?,?,?,?)')
    .run(id, req.params.id, b.column, b.body, req.user.name, b.ticket_key || null);
  const card = db.prepare('SELECT * FROM retro_cards WHERE id = ?').get(id);
  broadcast('retro.card.created', card);
  res.status(201).json(card);
});

app.patch('/api/retros/:id/cards/:cardId', requireAuth, (req, res) => {
  const card = db.prepare('SELECT * FROM retro_cards WHERE id = ? AND retro_id = ?').get(req.params.cardId, req.params.id);
  if (!card) return res.status(404).json({ error: 'card not found' });
  const b = req.body || {};
  db.prepare('UPDATE retro_cards SET body = ? WHERE id = ?').run(b.body ?? card.body, req.params.cardId);
  res.json(db.prepare('SELECT * FROM retro_cards WHERE id = ?').get(req.params.cardId));
});

app.delete('/api/retros/:id/cards/:cardId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM retro_cards WHERE id = ? AND retro_id = ?').run(req.params.cardId, req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 12. GitHub integration (6.7) - shared secret, not session auth
// ---------------------------------------------------------------------------

function extractTicketKeys(text) {
  if (!text) return [];
  const re = ticketKeyRegex();
  const matches = text.match(re) || [];
  return Array.from(new Set(matches));
}

app.post('/api/github/pr-opened', requireGithubToken, (req, res) => {
  const b = req.body || {};
  const keys = extractTicketKeys((b.branch || '') + ' ' + (b.title || '') + ' ' + (b.commit_message || ''));
  if (!keys.length) return res.json({ ok: true, matched: [] });
  const matched = [];
  for (const key of keys) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE key = ?').get(key);
    if (!ticket) continue;
    const found = findBoardByPrefix(ticket.key.split('-').slice(0, -1).join('-'));
    if (!found || !found.board.has_github) continue; // 6.7: only boards with has_github:true
    const codeReview = found.board.statuses.find((s) => /code review/i.test(s)) || found.board.statuses[0];
    db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE key = ?").run(codeReview, key);
    db.prepare('INSERT INTO github_links (id, ticket_key, kind, repo, ref, url, actor) VALUES (?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), key, 'pr', b.repo || 'unknown', b.branch || b.ref || '', b.url || null, b.actor || 'github');
    addSystemComment(key, 'PR opened' + (b.url ? ': ' + b.url : '') + ' by ' + (b.actor || 'someone') + '. Moved to "' + codeReview + '".');
    const updated = serializeTicket(db.prepare('SELECT * FROM tickets WHERE key = ?').get(key));
    broadcast('ticket.updated', updated);
    matched.push(key);
  }
  res.json({ ok: true, matched });
});

app.post('/api/github/deploy', requireGithubToken, (req, res) => {
  const b = req.body || {};
  const keys = extractTicketKeys((b.branch || '') + ' ' + (b.commit_message || '') + ' ' + (b.ref || ''));
  if (!keys.length) return res.json({ ok: true, matched: [] });
  const env = b.environment || 'staging';
  const matched = [];
  for (const key of keys) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE key = ?').get(key);
    if (!ticket) continue;
    const found = findBoardByPrefix(ticket.key.split('-').slice(0, -1).join('-'));
    if (!found || !found.board.has_github) continue;
    const target = env === 'production'
      ? (found.board.statuses.find((s) => /done/i.test(s)) || found.board.statuses[found.board.statuses.length - 1])
      : (found.board.statuses.find((s) => /qa|staging/i.test(s)) || found.board.statuses[found.board.statuses.length - 1]);
    db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE key = ?").run(target, key);
    db.prepare('INSERT INTO github_links (id, ticket_key, kind, repo, ref, url, actor, environment) VALUES (?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), key, 'deploy', b.repo || 'unknown', b.ref || b.branch || '', b.url || null, b.actor || 'github', env);
    addSystemComment(key, 'Deployed to ' + env + (b.url ? ': ' + b.url : '') + '. Moved to "' + target + '".');
    const updated = serializeTicket(db.prepare('SELECT * FROM tickets WHERE key = ?').get(key));
    broadcast('ticket.updated', updated);
    matched.push(key);
  }
  res.json({ ok: true, matched });
});

app.post('/api/github/release', requireGithubToken, (req, res) => {
  const b = req.body || {};
  const changelog = b.changelog || b.commits || '';
  const keys = extractTicketKeys(Array.isArray(changelog) ? changelog.join(' ') : String(changelog));
  const matched = [];
  for (const key of keys) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE key = ?').get(key);
    if (!ticket) continue;
    const found = findBoardByPrefix(ticket.key.split('-').slice(0, -1).join('-'));
    if (!found || !found.board.has_github) continue;
    const done = found.board.done_statuses[0];
    db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE key = ?").run(done, key);
    db.prepare('INSERT INTO github_links (id, ticket_key, kind, repo, ref, url, actor) VALUES (?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), key, 'release', b.repo || 'unknown', b.tag || '', b.url || null, b.actor || 'github');
    addSystemComment(key, 'Included in release ' + (b.tag || '') + '. Moved to "' + done + '".');
    const updated = serializeTicket(db.prepare('SELECT * FROM tickets WHERE key = ?').get(key));
    broadcast('ticket.updated', updated);
    matched.push(key);
  }
  res.json({ ok: true, matched });
});

// ---------------------------------------------------------------------------
// 13. Dashboard / overview (6.11) + My Tickets (17.6)
// ---------------------------------------------------------------------------

app.get('/api/overview', requireAuth, (req, res) => {
  const rows = [];
  for (const { project, board } of allBoards()) {
    const counts = boardCountsFor(project, board);
    const done7d = db.prepare(
      'SELECT COUNT(*) AS n FROM tickets WHERE project_slug=? AND board_slug=? AND status IN (' +
      board.done_statuses.map(() => '?').join(',') + ") AND updated_at >= datetime('now', '-7 days')"
    ).get(project.slug, board.slug, ...board.done_statuses).n;
    rows.push({
      project: project.name, project_slug: project.slug,
      board: board.name, board_slug: board.slug,
      open: counts.open, in_progress: counts.inProgress, done_7d: done7d
    });
  }
  res.json(rows);
});

app.get('/api/my-tickets', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM tickets WHERE assignee = ? ORDER BY updated_at DESC').all(req.user.email)
    .concat(db.prepare('SELECT * FROM tickets WHERE assignee = ? ORDER BY updated_at DESC').all(req.user.name))
    .filter((t, i, arr) => arr.findIndex((x) => x.key === t.key) === i)
    .map(serializeTicket));
});

// ---------------------------------------------------------------------------
// 14. Real-time (7.1)
// ---------------------------------------------------------------------------

app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ---------------------------------------------------------------------------
// 15. Admin (6.12)
// ---------------------------------------------------------------------------

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, email, name, is_admin, created_at FROM users ORDER BY created_at ASC').all());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.name || !b.password) return res.status(400).json({ error: 'email, name, password required' });
  const email = String(b.email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'a user with that email already exists' });
  const hash = bcrypt.hashSync(b.password, 10);
  const info = db.prepare('INSERT INTO users (email, name, password, is_admin) VALUES (?,?,?,?)')
    .run(email, b.name, hash, b.is_admin ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid, email, name: b.name, is_admin: !!b.is_admin });
});

app.patch('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.password || b.password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const hash = bcrypt.hashSync(b.password, 10);
  const info = db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'user not found' });
  res.json({ ok: true });
});

app.get('/api/admin/projects', requireAuth, requireAdmin, (req, res) => res.json(PROJECTS_CONFIG));

// ---------------------------------------------------------------------------
// 16. Static frontend (no build step) - NOT express.static on uploads/
// ---------------------------------------------------------------------------

app.use('/vendor', express.static(path.join(ROOT, 'vendor')));
app.get('/app.js', (req, res) => res.sendFile(path.join(ROOT, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use((req, res) => res.status(404).json({ error: 'not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[OfficePM] unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const server = app.listen(PORT, () => {
  console.log('[OfficePM] listening on http://localhost:' + PORT + ' (env=' + NODE_ENV + ')');
});

module.exports = { app, server, db };
