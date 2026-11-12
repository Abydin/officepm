import { eq, inArray, sql } from 'drizzle-orm';
import type { Participant, Ticket } from '@officepm/shared';
import type { AppContext } from '../../context.js';
import { schema } from '../../db/index.js';
import { serializeTicket, type TicketRow } from './serialize.js';

/**
 * What a ticket carries besides its own columns: its participants. Every shape here
 * is built without an email, however the underlying rows are keyed.
 */
export function createRelations(ctx: AppContext) {
  const { orm } = ctx.db;
  const { users, ticketParticipants } = schema;

  function participantsOf(keys: string[]): Map<string, Participant[]> {
    const out = new Map<string, Participant[]>();
    if (!keys.length) return out;
    const found = orm
      .select({
        ticket_key: ticketParticipants.ticket_key,
        id: users.id,
        name: users.name,
        department: users.department,
        role: ticketParticipants.role,
      })
      .from(ticketParticipants)
      .innerJoin(users, eq(users.id, ticketParticipants.user_id))
      .where(inArray(ticketParticipants.ticket_key, keys))
      .orderBy(sql`ticket_participants.rowid`)
      .all();
    for (const { ticket_key, ...person } of found) {
      const list = out.get(ticket_key) ?? [];
      list.push(person);
      out.set(ticket_key, list);
    }
    return out;
  }

  return {
    participantsOf,

    /** Rows to API tickets with their participants added (the board list). */
    decorateList(rows: TicketRow[]): Ticket[] {
      const people = participantsOf(rows.map((r) => r.key));
      return rows.map((row) => ({
        ...serializeTicket(row),
        participants: people.get(row.key) ?? [],
      }));
    },

    /** One row to an API ticket with its participants (the detail). */
    decorateOne(row: TicketRow): Ticket {
      return {
        ...serializeTicket(row),
        participants: participantsOf([row.key]).get(row.key) ?? [],
      };
    },
  };
}

export type Relations = ReturnType<typeof createRelations>;
