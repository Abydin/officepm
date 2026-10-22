'use strict';
// The database schema, shared by server.js and scripts/seed-demo.js so a fresh
// install can be seeded before the server has ever booted.

const SCHEMA_SQL = `
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
`;

// Columns added after v1.0. Added with ALTER TABLE so an existing pm.db upgrades
// in place on the next boot. Each is nullable, so old rows stay valid.
const TICKET_EXTRA_COLUMNS = [
  ['priority', 'TEXT'],
  ['labels', 'TEXT'],
  ['due_date', 'TEXT']
];

function migrate(db) {
  db.exec(SCHEMA_SQL);
  const have = new Set(db.prepare('PRAGMA table_info(tickets)').all().map((c) => c.name));
  for (const [name, type] of TICKET_EXTRA_COLUMNS) {
    if (!have.has(name)) db.exec('ALTER TABLE tickets ADD COLUMN ' + name + ' ' + type);
  }
}

module.exports = { SCHEMA_SQL, migrate };
