import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  HANDOFF_NOTE_MAX,
  HandoffRequestSchema,
  openPhaseTicketsMessage,
  openSubticketsMessage,
  planHandoff,
  planPhaseMove,
  type HandoffNotice,
  type HandoffResult,
} from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import type { BoardConfig } from '../../projects-config.js';
import type { TicketRow } from '../tickets/serialize.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import type { CommentService } from '../comments/service.js';
import { createPipelineService, isEpicRow } from '../pipeline/service.js';
import { createRelations } from '../tickets/relations.js';
import { serializeTicket } from '../tickets/serialize.js';

const MAX_ATTACHMENTS = 20;
const UNREAD_LIMIT = 100;

/** Trimmed text, or null when there is none. Callers have checked the type. */
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function createHandoffService(ctx: AppContext, comments: CommentService) {
  const { orm, raw } = ctx.db;
  const { tickets, ticketFiles, ticketHandoffs, handoffRecipients, ticketParticipants, users } =
    schema;
  const { projects, events } = ctx;
  const relations = createRelations(ctx);
  const pipeline = createPipelineService(ctx);

  const unreadStmt = raw.prepare(`
    SELECT h.id, h.ticket_key, t.title AS ticket_title, h.decision, h.from_status, h.to_status,
           h.from_name, h.note, h.reason, h.created_at
    FROM ticket_handoffs h
    JOIN tickets t ON t.key = h.ticket_key
    WHERE h.from_email <> @email
      AND (h.to_assignee = @email
           OR (h.to_assignee IS NULL AND lower(h.to_department) = lower(@department))
           OR EXISTS (
             SELECT 1 FROM handoff_recipients hr WHERE hr.handoff_id = h.id AND hr.user_id = @userId
           ))
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

  /** What a handoff does, whichever way the ticket moves. Everything below the plan is shared. */
  interface Move {
    /** null for a status change, else the ticket_handoffs.kind. */
    kind: 'phase' | 'phase_complete' | null;
    decision: 'approve' | 'reject';
    /** Stored as from_status / to_status. For a pipeline move these are phase names. */
    from: string;
    to: string;
    reason: string | null;
    line: string;
    statusAfter: string;
    /** undefined leaves tickets.phase alone. */
    phaseAfter?: string;
    phase?: { from: string; to: string | null; completed: boolean };
  }

  function planStatusMove(existing: TicketRow, board: BoardConfig, b: JsonBody): Move {
    if (typeof b.from_status === 'string' && b.from_status && b.from_status !== existing.status) {
      throw conflict(
        'this ticket moved to "' + existing.status + '" since you opened it, reload and try again',
      );
    }
    const plan = planHandoff(board, existing.status, b);
    if (!plan.ok) throw plan.status === 409 ? conflict(plan.message) : badRequest(plan.message);
    return {
      kind: null,
      decision: plan.decision,
      from: existing.status,
      to: plan.to,
      reason: plan.reason,
      statusAfter: plan.to,
      line:
        plan.decision === 'approve'
          ? `Handed off from ${existing.status} to ${plan.to}.`
          : `Sent back from ${existing.status} to ${plan.to}.`,
    };
  }

  /**
   * An epic on its pipeline. Approving out of the last phase completes the feature: the epic
   * keeps its last phase and takes the board's first done status. Sending a completed feature
   * back reopens it to the board's first status that is not done. Moving on while tickets tagged
   * with the phase being left are open needs move_anyway (approve only: sending back is when
   * work is expected to be open).
   */
  function planPipelineMove(
    existing: TicketRow & { phase: string },
    board: BoardConfig,
    b: JsonBody,
  ): Move {
    if (typeof b.from_phase === 'string' && b.from_phase && b.from_phase !== existing.phase) {
      throw conflict(
        'this feature moved to "' + existing.phase + '" since you opened it, reload and try again',
      );
    }
    const names = pipeline.phasesOf(existing.project_slug).map((p) => p.name);
    const plan = planPhaseMove(names, existing.phase, b);
    if (!plan.ok) throw plan.status === 409 ? conflict(plan.message) : badRequest(plan.message);

    const completed = plan.to === null;
    if (completed && pipeline.isCompleted(existing))
      throw conflict('this feature is already complete');
    let moveAnyway = '';
    if (plan.decision === 'approve') {
      const open = pipeline.openInPhase(existing, existing.phase);
      if (open) {
        if (b.move_anyway !== true) throw conflict(openPhaseTicketsMessage(open, existing.phase));
        moveAnyway = `\nMoved on with ${open} open ${open === 1 ? 'ticket' : 'tickets'} in ${existing.phase}.`;
      }
    }
    const done = board.done_statuses.includes(existing.status);
    let statusAfter = existing.status;
    if (completed)
      statusAfter = done ? existing.status : (board.done_statuses[0] ?? existing.status);
    else if (plan.decision === 'reject' && done) {
      statusAfter = board.statuses.find((s) => !board.done_statuses.includes(s)) ?? existing.status;
    }
    const line = completed
      ? `Completed the feature from ${existing.phase}.`
      : plan.decision === 'approve'
        ? `Moved from ${existing.phase} to ${plan.to}.`
        : `Sent back from ${existing.phase} to ${plan.to}.`;
    return {
      kind: completed ? 'phase_complete' : 'phase',
      decision: plan.decision,
      from: existing.phase,
      to: completed ? statusAfter : plan.to!,
      reason: plan.reason,
      line: line + moveAnyway,
      statusAfter,
      phaseAfter: completed ? existing.phase : plan.to!,
      phase: { from: existing.phase, to: plan.to, completed },
    };
  }

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

      // An epic that is on a pipeline moves between phases; everything else moves between statuses.
      const onPipeline = isEpicRow(existing) && existing.phase !== null;
      const move = onPipeline
        ? planPipelineMove(existing as typeof existing & { phase: string }, found.board, b)
        : planStatusMove(existing, found.board, b);

      const note = text(b.note);
      if (note && note.length > HANDOFF_NOTE_MAX) {
        throw badRequest('note must be ' + HANDOFF_NOTE_MAX + ' characters or fewer');
      }

      // Everyone else the handoff nudges. Each becomes a participant; the assignee stays single.
      const participantIds = [...new Set((b.participant_ids as number[] | null | undefined) ?? [])];
      const chosen = participantIds.length
        ? orm
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(users.id, participantIds))
            .all()
        : [];
      if (chosen.length !== participantIds.length) {
        throw badRequest('participant_ids must all be existing users');
      }

      // Closing a parent while its sub-tickets are open needs an explicit confirmation.
      if (
        move.kind === null &&
        found.board.done_statuses.includes(move.statusAfter) &&
        !found.board.done_statuses.includes(existing.status)
      ) {
        const open = orm
          .select()
          .from(tickets)
          .where(eq(tickets.subticket_of, key))
          .all()
          .filter((c) => !relations.isDone(c)).length;
        if (open && b.close_anyway !== true) throw conflict(openSubticketsMessage(open));
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

      const lines = [move.line];
      if (move.reason) lines.push(`Reason: ${move.reason}`);
      if (assignee) lines.push(`To: ${assignee.name}`);
      if (department) lines.push(`Department: ${department}`);
      let body = lines.join('\n');
      if (note) body += '\n\n' + note;
      if (files.length) body += '\n\nAttached: ' + files.map((f) => f.name).join(', ');

      const handoffId = crypto.randomUUID();
      let participantsChanged = false;
      const { comment, ticket } = raw.transaction(() => {
        orm
          .update(tickets)
          .set({
            status: move.statusAfter,
            ...(move.phaseAfter !== undefined ? { phase: move.phaseAfter } : {}),
            ...(assignee ? { assignee: assignee.email } : {}),
            updated_at: sql`datetime('now')`,
          })
          .where(eq(tickets.key, key))
          .run();
        const row = comments.record(key, user.name, body, 'handoff');
        const primary = assignee?.email ?? existing.assignee;
        const added = chosen.filter((p) => p.email !== primary);
        for (const person of added) {
          // An existing participant keeps their role.
          orm
            .insert(ticketParticipants)
            .values({ ticket_key: key, user_id: person.id, role: null, added_by: user.id })
            .onConflictDoNothing()
            .run();
        }
        const recipientIds = new Set([
          ...(assignee ? [assignee.id] : []),
          ...chosen.map((p) => p.id),
        ]);
        for (const userId of recipientIds) {
          orm.insert(handoffRecipients).values({ handoff_id: handoffId, user_id: userId }).run();
        }
        participantsChanged = added.length > 0;
        orm
          .insert(ticketHandoffs)
          .values({
            id: handoffId,
            ticket_key: key,
            decision: move.decision,
            from_status: move.from,
            to_status: move.to,
            kind: move.kind,
            reason: move.reason,
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
      if (participantsChanged) events.broadcast('ticket.participants.changed', { key });
      comments.announce(comment);
      // This event names who and where by id, with no note, reason or email: the recipient
      // fetches those from /handoffs/unread. The stream reaches every signed-in user and it
      // also carries comment.created (above) with the full comment body, as in v1, so the
      // note and reason are readable there by anyone signed in.
      events.broadcast('handoff.created', {
        id: handoffId,
        ticket_key: key,
        decision: move.decision,
        from_user_id: user.id,
        to_user_id: assignee?.id ?? null,
        to_user_ids: [...new Set([...(assignee ? [assignee.id] : []), ...participantIds])],
        to_department: department,
      });
      return {
        ticket,
        comment,
        handoff: {
          id: handoffId,
          decision: move.decision,
          from_status: move.from,
          to_status: move.to,
          to_user_id: assignee?.id ?? null,
          to_department: department,
        },
        ...(move.phase ? { phase: move.phase } : {}),
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
