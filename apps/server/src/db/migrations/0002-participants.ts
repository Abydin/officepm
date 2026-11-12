// More people on a ticket and multi-person handoffs. Additive only, so v1 still boots on a
// database this has touched: two new tables v1 never reads.
//
// ticket_participants: extra people on a ticket besides its one assignee, each with an
// optional short role. v1 has no foreign keys, so deleting a ticket removes its rows by
// hand (modules/tickets/service.ts), the same as comments and handoffs.
// handoff_recipients: everyone a handoff was addressed to beyond the assignee column,
// so each chosen person gets the unread indicator.
import type { Migration } from '../migrate.js';

export const PARTICIPANTS_SQL = `
CREATE TABLE IF NOT EXISTS ticket_participants (
  ticket_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT,
  added_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(ticket_key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_participants_user ON ticket_participants(user_id);

CREATE TABLE IF NOT EXISTS handoff_recipients (
  handoff_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY(handoff_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_handoff_recipients_user ON handoff_recipients(user_id);
`;

export const participants: Migration = {
  name: '0002-participants',
  up(db) {
    db.exec(PARTICIPANTS_SQL);
  },
};
