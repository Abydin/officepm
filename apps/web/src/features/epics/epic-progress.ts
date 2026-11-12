import type { Board, Ticket } from '@officepm/shared';

export interface EpicRow {
  epic: Ticket;
  children: Ticket[];
  done: number;
  total: number;
  percent: number;
}

/** Each epic on the board with the tickets whose parent_key points at it (sub-tickets excluded). */
export function epicRows(
  tickets: readonly Ticket[],
  board: Pick<Board, 'done_statuses'>,
): EpicRow[] {
  return tickets
    .filter((t) => t.level === 'epic')
    .map((epic) => {
      // A sub-ticket can sit in an epic too, but it is counted through its parent, not twice.
      const children = tickets.filter((t) => t.parent_key === epic.key && !t.subticket_of);
      const done = children.filter((t) => board.done_statuses.includes(t.status)).length;
      return {
        epic,
        children,
        done,
        total: children.length,
        percent: children.length ? Math.round((done / children.length) * 100) : 0,
      };
    });
}
