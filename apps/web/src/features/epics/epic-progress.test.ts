import { describe, expect, it } from 'vitest';
import { designBoard, makeTicket } from '@/test/fixtures';
import { epicRows } from './epic-progress';

describe('epicRows', () => {
  const board = { ...designBoard, done_statuses: ['Done'] };

  it('lists only epics, with children found by parent_key and progress by done statuses', () => {
    const tickets = [
      makeTicket({ key: 'E-1', level: 'epic', title: 'Epic' }),
      makeTicket({ key: 'S-1', parent_key: 'E-1', status: 'Done' }),
      makeTicket({ key: 'S-2', parent_key: 'E-1', status: 'In Progress' }),
      makeTicket({ key: 'S-3', parent_key: 'E-1', status: 'Done' }),
      makeTicket({ key: 'S-4', parent_key: 'E-9', status: 'Done' }),
    ];
    const rows = epicRows(tickets, board);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ done: 2, total: 3, percent: 67 });
    expect(rows[0]?.children.map((c) => c.key)).toEqual(['S-1', 'S-2', 'S-3']);
  });

  it('does not count a sub-ticket that sits in the epic, because its parent already counts it', () => {
    const tickets = [
      makeTicket({ key: 'E-1', level: 'epic' }),
      makeTicket({
        key: 'S-1',
        parent_key: 'E-1',
        status: 'Done',
        progress: { done: 1, total: 1 },
      }),
      makeTicket({ key: 'S-1a', parent_key: 'E-1', status: 'Done', subticket_of: 'S-1' }),
    ];
    const rows = epicRows(tickets, board);
    expect(rows[0]!.children.map((c) => c.key)).toEqual(['S-1']);
    expect(rows[0]).toMatchObject({ done: 1, total: 1 });
  });

  it('shows an epic with no children as 0 percent, not NaN', () => {
    const rows = epicRows([makeTicket({ key: 'E-1', level: 'epic' })], board);
    expect(rows[0]).toMatchObject({ done: 0, total: 0, percent: 0 });
  });
});
