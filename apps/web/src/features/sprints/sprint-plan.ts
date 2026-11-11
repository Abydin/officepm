import {
  ALLOWED_SPRINT_KINDS,
  DEFAULT_SPRINT_DAYS,
  type Board,
  type FlowId,
  type SprintKind,
  type Ticket,
} from '@officepm/shared';

/** What a board calls its time-box: PRD 6.10. */
export function sprintNoun(flow: FlowId): 'Sprint' | 'Cycle' | 'Phase' {
  return flow === 'shapeup' ? 'Cycle' : flow === 'waterfall' ? 'Phase' : 'Sprint';
}

/** The kinds the server accepts on a board of this flow. */
export const kindsFor = (flow: FlowId): readonly SprintKind[] => ALLOWED_SPRINT_KINDS[flow];

export function defaultKind(flow: FlowId): SprintKind {
  return kindsFor(flow)[0] ?? 'sprint';
}

/** Whole UTC days after an ISO date, as an ISO date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The end date the server would pick for a time-box that starts on `start`. */
export const timeboxEnd = (start: string, kind: SprintKind): string =>
  addDays(start, DEFAULT_SPRINT_DAYS[kind]);

export interface SprintStats {
  total: number;
  done: number;
  /** Story points in the sprint, whether or not the board shows them. */
  points: number;
  percent: number;
}

export function sprintStats(
  tickets: readonly Ticket[],
  sprintId: string,
  board: Pick<Board, 'done_statuses'>,
): SprintStats {
  const inSprint = tickets.filter((t) => t.sprint_id === sprintId);
  const done = inSprint.filter((t) => board.done_statuses.includes(t.status)).length;
  return {
    total: inSprint.length,
    done,
    points: inSprint.reduce((sum, t) => sum + (t.points ?? 0), 0),
    percent: inSprint.length ? Math.round((done / inSprint.length) * 100) : 0,
  };
}

/** Where a ticket can go: planned and active time-boxes, but not the one it is already in. */
export function moveTargets<S extends { id: string; status: string }>(
  sprints: readonly S[],
  currentId: string | null,
): S[] {
  return sprints.filter(
    (s) => s.id !== currentId && (s.status === 'planned' || s.status === 'active'),
  );
}
