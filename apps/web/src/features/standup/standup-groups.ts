import type { Ticket } from '@officepm/shared';
import { personName } from '@/lib/format';

export interface StandupGroup {
  assignee: string | null;
  name: string;
  tickets: Ticket[];
}

/** One group per assignee, people by name and the unassigned last. Newest change first within a group. */
export function standupGroups(tickets: readonly Ticket[]): StandupGroup[] {
  const byPerson = new Map<string | null, Ticket[]>();
  for (const t of tickets) byPerson.set(t.assignee, [...(byPerson.get(t.assignee) ?? []), t]);
  return [...byPerson.entries()]
    .map(([assignee, list]) => ({
      assignee,
      name: assignee ? personName(assignee) : 'Unassigned',
      tickets: [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }))
    .sort((a, b) =>
      a.assignee === null ? 1 : b.assignee === null ? -1 : a.name.localeCompare(b.name),
    );
}
