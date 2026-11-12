import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  DodPatchRequestSchema,
  EPIC_TYPE,
  TicketCreateRequestSchema,
  TicketPatchRequestSchema,
  type DodItem,
  type Ticket,
} from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { allocateTicketKey, resolveStoredPath, schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import { unlinkQuietly } from '../../lib/files.js';
import { transitionViolation } from './transitions.js';
import { labelsColumn, validateTicketExtras } from './validation.js';
import { serializeTicket } from './serialize.js';
import { createRelations } from './relations.js';

const TICKET_PATCHABLE = new Set([
  'title',
  'type',
  'status',
  'assignee',
  'qa_owner',
  'parent_key',
  'level',
  'description',
  'acceptance_criteria',
  'points',
  'appetite',
  'sprint_id',
  'blocked',
  'blocker_reason',
  'priority',
  'labels',
  'due_date',
]);

export interface TicketListQuery {
  project?: string;
  board?: string;
  assignee?: string;
  mine?: string;
  q?: string;
  limit?: string;
}

export function createTicketService(ctx: AppContext) {
  const { orm, raw } = ctx.db;
  const {
    tickets,
    ticketFiles,
    ticketLinks,
    comments,
    githubLinks,
    ticketDod,
    boardSettings,
    ticketHandoffs,
    handoffReads,
    handoffRecipients,
    ticketParticipants,
  } = schema;
  const { projects, events } = ctx;

  const relations = createRelations(ctx);
  const byKey = (key: string) => orm.select().from(tickets).where(eq(tickets.key, key)).get();

  function requireTicket(key: string) {
    const row = byKey(key);
    if (!row) throw notFound('ticket not found');
    return row;
  }

  return {
    list(query: TicketListQuery, user: SessionUser): Ticket[] {
      const where: SQL[] = [];
      if (query.project) where.push(eq(tickets.project_slug, query.project));
      if (query.board) where.push(eq(tickets.board_slug, query.board));
      if (query.assignee) where.push(eq(tickets.assignee, query.assignee));
      if (query.mine === '1' || query.mine === 'true') where.push(eq(tickets.assignee, user.email));
      // q and limit serve the command palette, so the browser stops fetching
      // every ticket per keystroke. Wildcards in q are not escaped, as in v1.
      if (query.q && query.q.trim()) {
        const needle = '%' + query.q.trim().toLowerCase() + '%';
        where.push(
          or(
            sql`lower(${tickets.key}) like ${needle}`,
            sql`lower(${tickets.title}) like ${needle}`,
          ) as SQL,
        );
      }
      const cap = Number(query.limit);
      const limit = Number.isInteger(cap) && cap > 0 && cap <= 200 ? cap : undefined;
      let q = orm
        .select()
        .from(tickets)
        .where(and(...where))
        .orderBy(desc(tickets.updated_at))
        .$dynamic();
      if (limit) q = q.limit(limit);
      return relations.decorateList(q.all());
    },

    /** `subticketOf` is set only by the sub-ticket module, which has already checked the rules. */
    create(b: JsonBody, subticketOf: string | null = null): Ticket {
      const found = projects.findBoard(b.project_slug, b.board_slug);
      if (!found) throw badRequest('unknown project/board');
      const { board } = found;
      if (!b.title) throw badRequest('title required');
      if (!board.types.includes(b.type as string)) {
        throw badRequest('type must be one of: ' + board.types.join(', '));
      }
      const status =
        b.status && board.statuses.includes(b.status as string)
          ? (b.status as string)
          : (board.statuses[0] as string);
      const extrasErr = validateTicketExtras(b);
      if (extrasErr) throw badRequest(extrasErr);
      requireShape(TicketCreateRequestSchema, b);

      const key = raw.transaction(() => {
        const next = allocateTicketKey(raw, board.prefix);
        orm
          .insert(tickets)
          .values({
            project_slug: found.project.slug,
            board_slug: board.slug,
            key: next,
            title: b.title as string,
            type: b.type as string,
            status,
            assignee: (b.assignee as string) || null,
            qa_owner: (b.qa_owner as string) || null,
            parent_key: (b.parent_key as string) || null,
            level: board.agile ? (b.level as string) || 'task' : null,
            description: (b.description as string) || null,
            acceptance_criteria: board.agile ? JSON.stringify(b.acceptance_criteria || []) : null,
            points: board.points ? ((b.points as number) ?? null) : null,
            appetite: board.flow === 'shapeup' ? (b.appetite as string) || null : null,
            sprint_id: (b.sprint_id as string) || null,
            blocked: board.agile && b.blocked ? 1 : 0,
            blocker_reason: (b.blocker_reason as string) || null,
            priority: (b.priority as string) || null,
            labels: labelsColumn(b.labels),
            due_date: (b.due_date as string) || null,
            subticket_of: subticketOf,
          })
          .run();
        return next;
      })();
      const ticket = serializeTicket(requireTicket(key));
      events.broadcast('ticket.created', ticket);
      return ticket;
    },

    get: (key: string): Ticket => relations.decorateOne(requireTicket(key)),

    patch(key: string, body: JsonBody): Ticket {
      const existing = requireTicket(key);
      const found = projects.findBoard(existing.project_slug, existing.board_slug);
      const extrasErr = validateTicketExtras(body);
      if (extrasErr) throw badRequest(extrasErr);

      const set: Record<string, unknown> = {};
      for (const field of Object.keys(body)) {
        if (!TICKET_PATCHABLE.has(field)) continue;
        if (field === 'status' && found && !found.board.statuses.includes(body.status as string)) {
          throw badRequest('status must be one of: ' + found.board.statuses.join(', '));
        }
        if (field === 'status' && found) {
          const violation = transitionViolation(
            found.board,
            existing.status,
            body.status as string,
          );
          if (violation) throw conflict(violation);
        }
        if (field === 'type' && found && !found.board.types.includes(body.type as string)) {
          throw badRequest('type must be one of: ' + found.board.types.join(', '));
        }
        // An epic is neither a sub-ticket nor a parent of them (see shared/subtickets.ts).
        if (field === 'type' && body.type === EPIC_TYPE && existing.type !== EPIC_TYPE) {
          const parentOrChild =
            existing.subticket_of ||
            orm
              .select({ key: tickets.key })
              .from(tickets)
              .where(eq(tickets.subticket_of, key))
              .get();
          if (parentOrChild) {
            throw conflict('a ticket that is, or has, sub-tickets cannot become an epic');
          }
        }
        const value = body[field];
        set[field] =
          field === 'acceptance_criteria'
            ? JSON.stringify(value || [])
            : field === 'labels'
              ? labelsColumn(value)
              : field === 'due_date'
                ? value || null
                : field === 'blocked'
                  ? value
                    ? 1
                    : 0
                  : value;
      }
      if (!Object.keys(set).length) throw badRequest('no patchable fields provided');
      requireShape(TicketPatchRequestSchema, body);

      orm
        .update(tickets)
        .set({ ...set, updated_at: sql`datetime('now')` })
        .where(eq(tickets.key, key))
        .run();
      const ticket = serializeTicket(requireTicket(key));
      events.broadcast('ticket.updated', ticket);
      return ticket;
    },

    remove(key: string): void {
      requireTicket(key);
      // Cascade by hand: comments, links, GitHub events, DoD state and participants go with
      // the ticket, files are unlinked, and children lose their parent rather than
      // being deleted in turn.
      const filePaths = orm
        .select({ stored_path: ticketFiles.stored_path })
        .from(ticketFiles)
        .where(eq(ticketFiles.ticket_key, key))
        .all();
      orm.transaction((tx) => {
        tx.delete(ticketFiles).where(eq(ticketFiles.ticket_key, key)).run();
        tx.delete(ticketLinks).where(eq(ticketLinks.ticket_key, key)).run();
        tx.delete(comments).where(eq(comments.ticket_key, key)).run();
        tx.delete(githubLinks).where(eq(githubLinks.ticket_key, key)).run();
        tx.delete(ticketDod).where(eq(ticketDod.ticket_key, key)).run();
        tx.delete(handoffRecipients)
          .where(
            inArray(
              handoffRecipients.handoff_id,
              tx
                .select({ id: ticketHandoffs.id })
                .from(ticketHandoffs)
                .where(eq(ticketHandoffs.ticket_key, key)),
            ),
          )
          .run();
        tx.delete(handoffReads)
          .where(
            inArray(
              handoffReads.handoff_id,
              tx
                .select({ id: ticketHandoffs.id })
                .from(ticketHandoffs)
                .where(eq(ticketHandoffs.ticket_key, key)),
            ),
          )
          .run();
        tx.delete(ticketHandoffs).where(eq(ticketHandoffs.ticket_key, key)).run();
        tx.delete(ticketParticipants).where(eq(ticketParticipants.ticket_key, key)).run();
        // Children lose their parent rather than being deleted, for epics and sub-tickets alike.
        tx.update(tickets).set({ parent_key: null }).where(eq(tickets.parent_key, key)).run();
        tx.update(tickets).set({ subticket_of: null }).where(eq(tickets.subticket_of, key)).run();
        tx.delete(tickets).where(eq(tickets.key, key)).run();
      });
      for (const f of filePaths) {
        const file = resolveStoredPath(ctx.config.dataDir, f.stored_path);
        if (file) unlinkQuietly(file);
      }
      events.broadcast('ticket.deleted', { key });
    },

    dod(key: string): DodItem[] {
      const ticket = requireTicket(key);
      const settings = orm
        .select({ definition_of_done: boardSettings.definition_of_done })
        .from(boardSettings)
        .where(
          and(
            eq(boardSettings.project_slug, ticket.project_slug),
            eq(boardSettings.board_slug, ticket.board_slug),
          ),
        )
        .get();
      const items: string[] = JSON.parse(settings?.definition_of_done || '[]');
      const state = orm
        .select({ item: ticketDod.item, done: ticketDod.done })
        .from(ticketDod)
        .where(eq(ticketDod.ticket_key, key))
        .all();
      const doneMap = Object.fromEntries(state.map((r) => [r.item, !!r.done]));
      return items.map((item) => ({ item, done: !!doneMap[item] }));
    },

    setDod(key: string, b: JsonBody): void {
      requireTicket(key);
      if (!b.item) throw badRequest('item required');
      requireShape(DodPatchRequestSchema, b);
      orm
        .insert(ticketDod)
        .values({ ticket_key: key, item: b.item as string, done: b.done ? 1 : 0 })
        .onConflictDoUpdate({
          target: [ticketDod.ticket_key, ticketDod.item],
          set: { done: sql`excluded.done` },
        })
        .run();
    },
  };
}

export type TicketService = ReturnType<typeof createTicketService>;
