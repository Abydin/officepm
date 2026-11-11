import type { Ticket } from '@officepm/shared';

/** Filter value for "nobody is assigned". */
export const UNASSIGNED = '__none';
/** Filter value for "assigned to the signed-in person". */
export const ASSIGNED_TO_ME = '__me';

export interface BoardFilters {
  assignee?: string;
  label?: string;
  q?: string;
}

export function filterTickets(
  tickets: readonly Ticket[],
  { assignee, label, q }: BoardFilters,
  meEmail: string,
): Ticket[] {
  const needle = q?.trim().toLowerCase();
  return tickets.filter((t) => {
    if (assignee === UNASSIGNED && t.assignee) return false;
    if (assignee === ASSIGNED_TO_ME && t.assignee !== meEmail) return false;
    if (
      assignee &&
      assignee !== UNASSIGNED &&
      assignee !== ASSIGNED_TO_ME &&
      t.assignee !== assignee
    )
      return false;
    if (label && !t.labels.includes(label)) return false;
    if (needle && !t.key.toLowerCase().includes(needle) && !t.title.toLowerCase().includes(needle))
      return false;
    return true;
  });
}

export const boardLabels = (tickets: readonly Ticket[]): string[] =>
  [...new Set(tickets.flatMap((t) => t.labels))].sort((a, b) => a.localeCompare(b));

// The filters live in the URL (?a=, ?l=, ?q=) so a filtered board can be shared
// and survives a reload. Other params, such as the drawer's ?t=, are left alone.
export function readFilters(params: URLSearchParams): Required<BoardFilters> {
  return {
    assignee: params.get('a') ?? '',
    label: params.get('l') ?? '',
    q: params.get('q') ?? '',
  };
}

export function writeFilters(params: URLSearchParams, filters: BoardFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [name, value] of [
    ['a', filters.assignee],
    ['l', filters.label],
    ['q', filters.q],
  ] as const) {
    if (value) next.set(name, value);
    else next.delete(name);
  }
  return next;
}
