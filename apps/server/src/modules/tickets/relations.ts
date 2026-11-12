import { eq, inArray, sql } from 'drizzle-orm';
import type { Participant, SubticketProgress, SubticketSummary, Ticket } from '@officepm/shared';
import type { AppContext } from '../../context.js';
import { schema } from '../../db/index.js';
import { serializeTicket, type TicketRow } from './serialize.js';

/**
 * What a ticket carries besides its own columns: its participants and its sub-tickets.
 * Every shape here is built without an email, however the underlying rows are keyed.
 */
export function createRelations(ctx: AppContext) {
  const { orm } = ctx.db;
  const { tickets, users, ticketParticipants } = schema;

  const isDone = (row: { project_slug: string; board_slug: string; status: string }) =>
    ctx.projects
      .findBoard(row.project_slug, row.board_slug)
      ?.board.done_statuses.includes(row.status) ?? false;

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

  function childrenOf(parentKeys: string[]) {
    return parentKeys.length
      ? orm.select().from(tickets).where(inArray(tickets.subticket_of, parentKeys)).all()
      : [];
  }

  /** A name for an assignee value, or null. v1 keeps an email there, sometimes a plain name. */
  function assigneeNames(values: Array<string | null>): Map<string, string> {
    const wanted = [...new Set(values.filter((v): v is string => !!v))];
    const names = new Map<string, string>();
    if (!wanted.length) return names;
    for (const u of orm
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.email, wanted))
      .all()) {
      names.set(u.email, u.name);
    }
    for (const v of wanted) if (!names.has(v) && !v.includes('@')) names.set(v, v);
    return names;
  }

  function progressOf(children: TicketRow[]): SubticketProgress {
    return { done: children.filter(isDone).length, total: children.length };
  }

  return {
    isDone,
    participantsOf,
    progressOf,

    /** Rows to API tickets with participants and progress added (the board list). */
    decorateList(rows: TicketRow[]): Ticket[] {
      const keys = rows.map((r) => r.key);
      const people = participantsOf(keys);
      const kids = new Map<string, TicketRow[]>();
      for (const child of childrenOf(keys)) {
        const list = kids.get(child.subticket_of!) ?? [];
        list.push(child);
        kids.set(child.subticket_of!, list);
      }
      return rows.map((row) => ({
        ...serializeTicket(row),
        participants: people.get(row.key) ?? [],
        progress: progressOf(kids.get(row.key) ?? []),
      }));
    },

    /** One row to an API ticket with participants, sub-tickets and progress (the detail). */
    decorateOne(row: TicketRow): Ticket {
      const children = childrenOf([row.key]).sort((a, b) => a.id - b.id);
      const names = assigneeNames(children.map((c) => c.assignee));
      const subtickets: SubticketSummary[] = children.map((c) => ({
        key: c.key,
        title: c.title,
        status: c.status,
        type: c.type,
        assignee_name: c.assignee ? (names.get(c.assignee) ?? null) : null,
      }));
      return {
        ...serializeTicket(row),
        participants: participantsOf([row.key]).get(row.key) ?? [],
        subtickets,
        progress: progressOf(children),
      };
    },
  };
}

export type Relations = ReturnType<typeof createRelations>;
