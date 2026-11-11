import { describe, expect, it } from 'vitest';
import { makeTicket } from '@/test/fixtures';
import { standupGroups } from './standup-groups';

describe('standupGroups', () => {
  it('groups by assignee, people alphabetically by name, unassigned last', () => {
    const groups = standupGroups([
      makeTicket({ key: 'A-1', assignee: 'tunde.bakare@x.demo' }),
      makeTicket({ key: 'A-2', assignee: null }),
      makeTicket({ key: 'A-3', assignee: 'maya.okafor@x.demo' }),
      makeTicket({ key: 'A-4', assignee: 'tunde.bakare@x.demo' }),
    ]);
    expect(groups.map((g) => [g.name, g.tickets.map((t) => t.key)])).toEqual([
      ['Maya Okafor', ['A-3']],
      ['Tunde Bakare', ['A-1', 'A-4']],
      ['Unassigned', ['A-2']],
    ]);
    expect(groups[2]?.assignee).toBeNull();
  });

  it('orders a person tickets with the most recently updated first', () => {
    const groups = standupGroups([
      makeTicket({ key: 'A-1', assignee: 'a@x', updated_at: '2026-10-01 09:00:00' }),
      makeTicket({ key: 'A-2', assignee: 'a@x', updated_at: '2026-10-03 09:00:00' }),
    ]);
    expect(groups[0]?.tickets.map((t) => t.key)).toEqual(['A-2', 'A-1']);
  });
});
