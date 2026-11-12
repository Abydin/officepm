// The feature pipeline. Additive only, so v1 still boots on a database this has touched:
// one new table v1 never reads and three nullable columns.
//
// project_phases: the ordered phase list a project configured. A project that never
// configured one has no rows and uses the built-in default (shared/pipeline.ts), so
// nothing has to be written for it.
// tickets.phase: on an epic, the phase the feature is in now (NULL until it starts a
// pipeline); on a ticket under an epic, the phase the ticket is tagged with. Stored by
// name: a rename rewrites it in the same transaction as the rename.
// tickets.department: the team lane a ticket under an epic belongs to (Backend, Frontend).
// ticket_handoffs.kind: NULL for the status handoffs that existed before, 'phase' for a
// move between phases and 'phase_complete' for the approval that finishes a feature.
import type { Migration } from '../migrate.js';
import { addMissingColumns } from './0000-baseline.js';

export const PIPELINE_SQL = `
CREATE TABLE IF NOT EXISTS project_phases (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  position INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_slug, position);
`;

export const pipeline: Migration = {
  name: '0004-pipeline',
  up(db) {
    db.exec(PIPELINE_SQL);
    addMissingColumns(db, 'tickets', [
      ['phase', 'TEXT'],
      ['department', 'TEXT'],
    ]);
    addMissingColumns(db, 'ticket_handoffs', [['kind', 'TEXT']]);
  },
};
