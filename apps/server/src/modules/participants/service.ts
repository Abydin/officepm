import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { ParticipantAddSchema, type Participant, type Ticket } from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import { createRelations } from '../tickets/relations.js';
import { serializeTicket } from '../tickets/serialize.js';

/**
 * Extra people on a ticket. Who may change them is who may PATCH a ticket: any
 * signed-in user, because v1 has no per-ticket permissions and this adds none.
 * Every shape returned is id, name, department and role, never an email.
 */
export function createParticipantService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { tickets, users, ticketParticipants } = schema;
  const { events } = ctx;
  const relations = createRelations(ctx);

  const requireTicket = (key: string) => {
    const row = orm.select().from(tickets).where(eq(tickets.key, key)).get();
    if (!row) throw notFound('ticket not found');
    return row;
  };

  const list = (key: string): Participant[] => relations.participantsOf([key]).get(key) ?? [];

  return {
    list(key: string): Participant[] {
      requireTicket(key);
      return list(key);
    },

    /** Adds a person, or changes their role when they are already on the ticket. */
    add(key: string, b: JsonBody, user: SessionUser): { person: Participant; created: boolean } {
      const ticket = requireTicket(key);
      // The user id is checked before the role so a bad id is reported as that, not as a role.
      if (typeof b.user_id !== 'number' || !Number.isInteger(b.user_id)) {
        throw badRequest('user_id must be an integer');
      }
      requireShape(ParticipantAddSchema, b);
      const person = orm
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, b.user_id))
        .get();
      if (!person) throw badRequest('user_id must be an existing user');
      if (ticket.assignee && ticket.assignee === person.email) {
        throw conflict('that person is the assignee already');
      }
      const role = typeof b.role === 'string' ? b.role.trim() : null;
      const existing = orm
        .select({ user_id: ticketParticipants.user_id })
        .from(ticketParticipants)
        .where(
          and(eq(ticketParticipants.ticket_key, key), eq(ticketParticipants.user_id, person.id)),
        )
        .get();
      if (existing) {
        orm
          .update(ticketParticipants)
          .set({ role })
          .where(
            and(eq(ticketParticipants.ticket_key, key), eq(ticketParticipants.user_id, person.id)),
          )
          .run();
      } else {
        orm
          .insert(ticketParticipants)
          .values({ ticket_key: key, user_id: person.id, role, added_by: user.id })
          .run();
      }
      events.broadcast('ticket.participants.changed', { key });
      return { person: list(key).find((p) => p.id === person.id)!, created: !existing };
    },

    remove(key: string, userId: string): void {
      requireTicket(key);
      const id = Number(userId);
      if (!/^\d+$/.test(userId) || !Number.isSafeInteger(id)) throw badRequest('invalid user id');
      // Scoped to this ticket key: the same person on another ticket is never touched.
      const removed = orm
        .delete(ticketParticipants)
        .where(and(eq(ticketParticipants.ticket_key, key), eq(ticketParticipants.user_id, id)))
        .run();
      if (!removed.changes) throw notFound('that person is not on this ticket');
      events.broadcast('ticket.participants.changed', { key });
    },

    /** Tickets the person takes part in and is not already the assignee of. */
    participating(user: SessionUser): Ticket[] {
      const rows = orm
        .select({ t: tickets })
        .from(ticketParticipants)
        .innerJoin(tickets, eq(tickets.key, ticketParticipants.ticket_key))
        .where(
          and(
            eq(ticketParticipants.user_id, user.id),
            or(
              sql`${tickets.assignee} IS NULL`,
              and(ne(tickets.assignee, user.email), ne(tickets.assignee, user.name)),
            ),
          ),
        )
        .orderBy(desc(tickets.updated_at))
        .all()
        .map((r) => r.t);
      const people = relations.participantsOf(rows.map((r) => r.key));
      return rows.map((row) => ({
        ...serializeTicket(row),
        participants: people.get(row.key) ?? [],
      }));
    },
  };
}

/** Rows are checked by the caller; used by the handoff, which adds people inside its own transaction. */
export function participantIdsExist(ctx: AppContext, ids: number[]): boolean {
  if (!ids.length) return true;
  const { users } = schema;
  return (
    ctx.db.orm.select({ id: users.id }).from(users).where(inArray(users.id, ids)).all().length ===
    ids.length
  );
}

export type ParticipantService = ReturnType<typeof createParticipantService>;
