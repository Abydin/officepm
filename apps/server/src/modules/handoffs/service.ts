import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  HANDOFF_NOTE_MAX,
  HandoffRequestSchema,
  planHandoff,
  type HandoffNotice,
  type HandoffResult,
} from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import type { CommentService } from '../comments/service.js';
import { serializeTicket } from '../tickets/serialize.js';

const MAX_ATTACHMENTS = 20;
const UNREAD_LIMIT = 100;

/** Trimmed text, or null when there is none. Callers have checked the type. */
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function createHandoffService(ctx: AppContext, comments: CommentService) {
  const { orm, raw } = ctx.db;
  const { tickets, ticketFiles, ticketHandoffs, users } = schema;
  const { projects, events } = ctx;

  const unreadStmt = raw.prepare(`
    SELECT h.id, h.ticket_key, t.title AS ticket_title, h.decision, h.from_status, h.to_status,
           h.from_name, h.note, h.reason, h.created_at
    FROM ticket_handoffs h
    JOIN tickets t ON t.key = h.ticket_key
    WHERE h.from_email <> @email
      AND (h.to_assignee = @email
           OR (h.to_assignee IS NULL AND lower(h.to_department) = lower(@department)))
      AND NOT EXISTS (
        SELECT 1 FROM handoff_reads r WHERE r.handoff_id = h.id AND r.user_id = @userId
      )
    ORDER BY h.created_at DESC, h.rowid DESC
    LIMIT ${UNREAD_LIMIT}
  `);

  const markReadStmt = raw.prepare(`
    INSERT OR IGNORE INTO handoff_reads (handoff_id, user_id)
    SELECT id, ? FROM ticket_handoffs WHERE ticket_key = ?
  `);

  return {
    /**
     * Moves a ticket on from one stage, and tells the next handler. Everything is
     * checked before anything is written, then the move, the assignee, the comment and
     * the handoff row commit together or not at all. The status rule is the one
     * PATCH and the GitHub webhooks use (planHandoff calls transitionViolation).
     */
    create(key: string, b: JsonBody, user: SessionUser): HandoffResult {
      const existing = orm.select().from(tickets).where(eq(tickets.key, key)).get();
      if (!existing) throw notFound('ticket not found');
      const found = projects.findBoard(existing.project_slug, existing.board_slug);
      if (!found) throw conflict('this ticket belongs to a board that is not configured');
      requireShape(HandoffRequestSchema, b);

      if (typeof b.from_status === 'string' && b.from_status && b.from_status !== existing.status) {
        throw conflict(
          'this ticket moved to "' +
            existing.status +
            '" since you opened it, reload and try again',
        );
      }
      const plan = planHandoff(found.board, existing.status, b);
      if (!plan.ok) throw plan.status === 409 ? conflict(plan.message) : badRequest(plan.message);

      const note = text(b.note);
      if (note && note.length > HANDOFF_NOTE_MAX) {
        throw badRequest('note must be ' + HANDOFF_NOTE_MAX + ' characters or fewer');
      }

      // People are named by user id: the picker list (GET /api/people) has no emails. The returned
      // ticket still shows the chosen assignee's email, as every ticket does in v1.
      const assigneeId = typeof b.assignee_id === 'number' ? b.assignee_id : null;
      const assignee =
        assigneeId === null
          ? undefined
          : orm
              .select({ id: users.id, email: users.email, name: users.name })
              .from(users)
              .where(eq(users.id, assigneeId))
              .get();
      if (assigneeId !== null && !assignee)
        throw badRequest('assignee_id must be an existing user');

      const requestedDepartment = text(b.department);
      let department: string | null = null;
      if (requestedDepartment) {
        const match = orm
          .select({ department: users.department })
          .from(users)
          .where(sql`lower(${users.department}) = lower(${requestedDepartment})`)
          .get();
        if (!match?.department) throw badRequest('unknown department');
        department = match.department;
      }

      const attachmentIds = [...new Set((b.attachment_ids as string[] | null | undefined) ?? [])];
      if (attachmentIds.length > MAX_ATTACHMENTS) {
        throw badRequest('at most ' + MAX_ATTACHMENTS + ' attachments');
      }
      const files = attachmentIds.length
        ? orm
            .select({ id: ticketFiles.id, name: ticketFiles.original_name })
            .from(ticketFiles)
            .where(and(eq(ticketFiles.ticket_key, key), inArray(ticketFiles.id, attachmentIds)))
            .all()
        : [];
      if (files.length !== attachmentIds.length) {
        throw badRequest('attachment not found on this ticket');
      }

      const lines = [
        plan.decision === 'approve'
          ? `Handed off from ${existing.status} to ${plan.to}.`
          : `Sent back from ${existing.status} to ${plan.to}.`,
      ];
      if (plan.reason) lines.push(`Reason: ${plan.reason}`);
      if (assignee) lines.push(`To: ${assignee.name}`);
      if (department) lines.push(`Department: ${department}`);
      let body = lines.join('\n');
      if (note) body += '\n\n' + note;
      if (files.length) body += '\n\nAttached: ' + files.map((f) => f.name).join(', ');

      const handoffId = crypto.randomUUID();
      const { comment, ticket } = raw.transaction(() => {
        orm
          .update(tickets)
          .set({
            status: plan.to,
            ...(assignee ? { assignee: assignee.email } : {}),
            updated_at: sql`datetime('now')`,
          })
          .where(eq(tickets.key, key))
          .run();
        const row = comments.record(key, user.name, body, 'handoff');
        orm
          .insert(ticketHandoffs)
          .values({
            id: handoffId,
            ticket_key: key,
            decision: plan.decision,
            from_status: existing.status,
            to_status: plan.to,
            reason: plan.reason,
            note,
            from_email: user.email,
            from_name: user.name,
            to_assignee: assignee?.email ?? null,
            to_department: department,
            attachment_ids: files.length ? JSON.stringify(files.map((f) => f.id)) : null,
            comment_id: row.id,
          })
          .run();
        return {
          comment: row,
          ticket: serializeTicket(orm.select().from(tickets).where(eq(tickets.key, key)).get()!),
        };
      })();

      events.broadcast('ticket.updated', ticket);
      comments.announce(comment);
      // This event names who and where by id, with no note, reason or email: the recipient
      // fetches those from /handoffs/unread. The stream reaches every signed-in user and it
      // also carries comment.created (above) with the full comment body, as in v1, so the
      // note and reason are readable there by anyone signed in.
      events.broadcast('handoff.created', {
        id: handoffId,
        ticket_key: key,
        decision: plan.decision,
        from_user_id: user.id,
        to_user_id: assignee?.id ?? null,
        to_department: department,
      });
      return {
        ticket,
        comment,
        handoff: {
          id: handoffId,
          decision: plan.decision,
          from_status: existing.status,
          to_status: plan.to,
          to_user_id: assignee?.id ?? null,
          to_department: department,
        },
      };
    },

    /** Handoffs addressed to this person (by email, or by department when no person was named) and not read yet. */
    unread(user: SessionUser): HandoffNotice[] {
      const me = orm
        .select({ department: users.department })
        .from(users)
        .where(eq(users.id, user.id))
        .get();
      return unreadStmt.all({
        email: user.email,
        department: me?.department ?? null,
        userId: user.id,
      }) as HandoffNotice[];
    },

    /** Marks every handoff on a ticket as read for this person: opening the ticket does it. */
    markRead(key: string, user: SessionUser): void {
      if (!orm.select({ key: tickets.key }).from(tickets).where(eq(tickets.key, key)).get()) {
        throw notFound('ticket not found');
      }
      markReadStmt.run(user.id, key);
    },
  };
}

export type HandoffService = ReturnType<typeof createHandoffService>;
