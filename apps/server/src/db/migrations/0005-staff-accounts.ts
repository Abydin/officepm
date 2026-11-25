// Staff accounts: invite links, forced password change and deactivation. Additive only, so v1
// still boots on a database this has touched: one new table v1 never reads and two columns on
// users that v1 neither reads nor writes (v1's own INSERT leaves both at their defaults).
//
// users.must_change_password: 1 while the person has to choose a new password. Set when an
// admin creates an account or resets a password. NULL counts as 0.
// users.deactivated_at: when an admin switched the account off, NULL while it is active.
// invites: one row per invite link. Only a SHA-256 hash of the token is stored, so a copy of
// the database cannot be turned into working links. A revoked invite is deleted.
import type { Migration } from '../migrate.js';
import { addMissingColumns } from './0000-baseline.js';

export const INVITES_SQL = `
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
`;

export const staffAccounts: Migration = {
  name: '0005-staff-accounts',
  up(db) {
    addMissingColumns(db, 'users', [
      ['must_change_password', 'INTEGER DEFAULT 0'],
      ['deactivated_at', 'TEXT'],
    ]);
    db.exec(INVITES_SQL);
  },
};
