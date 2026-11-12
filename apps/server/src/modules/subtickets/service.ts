import { and, eq, sql } from 'drizzle-orm';
import {
  EPIC_TYPE,
  SubticketCreateSchema,
  SubticketOfSchema,
  subticketViolation,
  type SubticketNode,
  type Ticket,
} from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import { serializeTicket, type TicketRow } from '../tickets/serialize.js';
import type { TicketService } from '../tickets/service.js';

/**
 * Sub-tickets: ordinary tickets (own key, same statuses and workflow rules) with
 * tickets.subticket_of set, one level deep. The rules are shared/subtickets.ts.
 * Who may use them is who may PATCH a ticket: any signed-in user.
 */
export function createSubticketService(ctx: AppContext, ticketService: TicketService) {
  const { orm } = ctx.db;
  const { tickets } = schema;
  const { projects, events } = ctx;

  const find = (key: string) => orm.select().from(tickets).where(eq(tickets.key, key)).get();
  const node = (row: TicketRow): SubticketNode => ({
    key: row.key,
    type: row.type,
    level: row.level,
    project_slug: row.project_slug,
    subticket_of: row.subticket_of,
    has_subtickets: !!orm
      .select({ key: tickets.key })
      .from(tickets)
      .where(eq(tickets.subticket_of, row.key))
      .get(),
  });

  return {
    /** A new ticket on the parent's board, belonging to the parent. */
    create(parentKey: string, b: JsonBody): Ticket {
      const parent = find(parentKey);
      if (!parent) throw notFound('ticket not found');
      if (typeof b.title !== 'string' || !b.title.trim()) throw badRequest('title required');
      requireShape(SubticketCreateSchema, b);
      const found = projects.findBoard(parent.project_slug, parent.board_slug);
      if (!found) throw conflict('this ticket belongs to a board that is not configured');
      const { types } = found.board;

      const type =
        typeof b.type === 'string' && b.type
          ? b.type
          : types.includes('task')
            ? 'task'
            : types.find((t) => t !== EPIC_TYPE);
      if (type === EPIC_TYPE) throw badRequest('an epic cannot be a sub-ticket');
      if (!type || !types.includes(type))
        throw badRequest('type must be one of: ' + types.join(', '));

      // The child does not exist yet, so only the parent-side rules can fire here.
      const violation = subticketViolation(
        {
          key: '',
          type,
          project_slug: parent.project_slug,
          subticket_of: null,
          has_subtickets: false,
        },
        node(parent),
      );
      if (violation) throw conflict(violation);

      return ticketService.create(
        {
          project_slug: parent.project_slug,
          board_slug: parent.board_slug,
          title: b.title.trim(),
          type,
          ...(b.assignee ? { assignee: b.assignee } : {}),
        },
        parent.key,
      );
    },

    /** Makes an existing ticket a sub-ticket of another (or, with null, a normal ticket again). */
    attach(key: string, b: JsonBody): Ticket {
      const child = find(key);
      if (!child) throw notFound('ticket not found');
      requireShape(SubticketOfSchema, b);
      const parentKey = b.parent_key as string | null;

      if (parentKey !== null) {
        const parent = find(parentKey);
        if (!parent) throw notFound('parent ticket not found');
        const violation = subticketViolation(node(child), node(parent));
        if (violation) throw conflict(violation);
      }
      orm
        .update(tickets)
        .set({ subticket_of: parentKey, updated_at: sql`datetime('now')` })
        .where(and(eq(tickets.key, key)))
        .run();
      const ticket = serializeTicket(find(key)!);
      events.broadcast('ticket.updated', ticket);
      return ticket;
    },
  };
}

export type SubticketService = ReturnType<typeof createSubticketService>;
