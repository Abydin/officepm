// Departments and handoffs. Additive only, so v1 still boots on a database this has
// touched: one nullable column on users and two new tables v1 never reads.
//
// ticket_handoffs is one row per status-change handoff (who, from and to, the note and
// the people it was addressed to). handoff_reads is the per-person "seen" mark, kept
// apart because a handoff to a department has several recipients and each reads it
// on their own.
import type { Migration } from '../migrate.js';
import { addMissingColumns } from './0000-baseline.js';

export const HANDOFFS_SQL = `
CREATE TABLE IF NOT EXISTS ticket_handoffs (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  decision TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT,
  note TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_assignee TEXT,
  to_department TEXT,
  attachment_ids TEXT,
  comment_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_handoffs_ticket ON ticket_handoffs(ticket_key);
CREATE INDEX IF NOT EXISTS idx_ticket_handoffs_assignee ON ticket_handoffs(to_assignee);

CREATE TABLE IF NOT EXISTS handoff_reads (
  handoff_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  read_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(handoff_id, user_id)
);
`;

export const handoffs: Migration = {
  name: '0001-handoffs',
  up(db) {
    addMissingColumns(db, 'users', [['department', 'TEXT']]);
    db.exec(HANDOFFS_SQL);
  },
};
