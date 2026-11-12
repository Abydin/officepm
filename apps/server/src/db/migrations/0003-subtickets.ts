// Sub-tickets. Additive only, so v1 still boots on a database this has touched: one
// nullable column on tickets and no rewritten rows.
//
// tickets.subticket_of is the key of the ticket a sub-ticket belongs to. It is separate
// from tickets.parent_key, which stays the epic relation, so a ticket can be in an epic
// and have sub-tickets without either meaning getting mixed up. One level only: the
// rules are enforced in shared/subtickets.ts, not by the schema.
import type { Migration } from '../migrate.js';
import { addMissingColumns } from './0000-baseline.js';

export const subtickets: Migration = {
  name: '0003-subtickets',
  up(db) {
    addMissingColumns(db, 'tickets', [['subticket_of', 'TEXT']]);
  },
};
