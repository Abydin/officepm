// The status-change rules shared by the server and the handoff modal, so the
// client offers exactly what the server will accept and the two cannot drift.
import { flowSupports, type FlowId } from './flows.js';

/** The two things the rules need to know about a board. */
export interface WorkflowBoard {
  flow: FlowId;
  statuses: readonly string[];
}

export const HANDOFF_REASON_MAX = 1000;
export const HANDOFF_NOTE_MAX = 2000;

/**
 * Why a status change is not allowed on this board, or null when it is. Waterfall
 * phases are sequential (PRD 17 open question 4): going forward may not skip a
 * phase, moving back is always allowed. v1 applies this to exactly the flows whose
 * capability table says they run in phases. One rule for every way a ticket moves:
 * the PATCH route, the GitHub webhooks and the handoff all call it.
 */
export function transitionViolation(board: WorkflowBoard, from: string, to: string): string | null {
  if (!flowSupports(board.flow, 'phases') || to === from) return null;
  const { statuses } = board;
  const oldIdx = statuses.indexOf(from);
  const newIdx = statuses.indexOf(to);
  if (newIdx <= oldIdx + 1) return null;
  return (
    'Waterfall boards are sequential only (PRD 17.4): move through "' +
    statuses[oldIdx + 1] +
    '" first, this board does not allow skipping ahead to "' +
    to +
    '"'
  );
}

export interface HandoffOptions {
  /** The status right after this one, or null on the last. */
  next: string | null;
  /** The status right before this one, or null on the first. */
  previous: string | null;
  /** Later statuses the workflow allows moving to. */
  forward: string[];
  /** Earlier statuses, all of which are allowed. */
  back: string[];
}

/** Where a ticket in `from` can be sent: what the modal's two target pickers list. */
export function handoffOptions(board: WorkflowBoard, from: string): HandoffOptions {
  const idx = board.statuses.indexOf(from);
  if (idx === -1) return { next: null, previous: null, forward: [], back: [] };
  const later = board.statuses.slice(idx + 1);
  return {
    next: later[0] ?? null,
    previous: board.statuses[idx - 1] ?? null,
    forward: later.filter((s) => transitionViolation(board, from, s) === null),
    back: board.statuses.slice(0, idx),
  };
}

export type HandoffPlan =
  | { ok: true; decision: 'approve' | 'reject'; to: string; reason: string | null }
  | { ok: false; status: 400 | 409; message: string };

const refuse = (status: 400 | 409, message: string): HandoffPlan => ({
  ok: false,
  status,
  message,
});

/**
 * Decides where a handoff moves the ticket, or why it cannot. Approve goes forward
 * (default: the next status), reject goes back (default: the previous status) and
 * needs a reason. Both obey `transitionViolation`.
 */
export function planHandoff(
  board: WorkflowBoard,
  from: string,
  input: { decision?: unknown; to_status?: unknown; reason?: unknown },
): HandoffPlan {
  const { decision } = input;
  if (decision !== 'approve' && decision !== 'reject') {
    return refuse(400, 'decision must be approve or reject');
  }
  const fromIdx = board.statuses.indexOf(from);
  if (fromIdx === -1) {
    return refuse(409, 'the ticket status "' + from + '" is not part of this board');
  }

  let to: string;
  if (input.to_status === undefined || input.to_status === null || input.to_status === '') {
    const fallback =
      decision === 'approve' ? board.statuses[fromIdx + 1] : board.statuses[fromIdx - 1];
    if (fallback === undefined) {
      return refuse(
        409,
        decision === 'approve'
          ? 'there is no later status after "' + from + '"'
          : 'there is no earlier status before "' + from + '"',
      );
    }
    to = fallback;
  } else {
    if (typeof input.to_status !== 'string' || !board.statuses.includes(input.to_status)) {
      return refuse(400, 'to_status must be one of: ' + board.statuses.join(', '));
    }
    to = input.to_status;
  }

  const toIdx = board.statuses.indexOf(to);
  if (decision === 'approve' && toIdx <= fromIdx) {
    return refuse(400, 'approve must move to a later status');
  }
  if (decision === 'reject' && toIdx >= fromIdx) {
    return refuse(400, 'reject must move to an earlier status');
  }

  let reason: string | null = null;
  if (decision === 'reject') {
    reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) return refuse(400, 'a reason is required when sending a ticket back');
    if (reason.length > HANDOFF_REASON_MAX) {
      return refuse(400, 'reason must be ' + HANDOFF_REASON_MAX + ' characters or fewer');
    }
  }

  const violation = transitionViolation(board, from, to);
  if (violation) return refuse(409, violation);
  return { ok: true, decision, to, reason };
}
