import type { Ticket } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { boardLabels, filterTickets, readFilters, writeFilters } from './board-filter';

const t = (over: Partial<Ticket>): Ticket => ({
  id: 1,
  project_slug: 'food',
  board_slug: 'eng',
  key: 'FOOD-ENG-1',
  title: 'Group ordering',
  type: 'story',
  status: 'Backlog',
  assignee: null,
  qa_owner: null,
  parent_key: null,
  level: null,
  description: null,
  acceptance_criteria: [],
  points: null,
  appetite: null,
  sprint_id: null,
  blocked: false,
  blocker_reason: null,
  priority: null,
  labels: [],
  due_date: null,
  created_at: '',
  updated_at: '',
  ...over,
});

const list = [
  t({ key: 'A-1', title: 'Checkout total', assignee: 'maya@x.test', labels: ['payments'] }),
  t({ key: 'A-2', title: 'Order emails', assignee: 'sam@x.test', labels: ['email', 'ui'] }),
  t({ key: 'A-3', title: 'Printer layout', labels: [] }),
];

describe('filterTickets', () => {
  it('keeps everything when no filter is set', () => {
    expect(filterTickets(list, {}, 'maya@x.test')).toHaveLength(3);
  });
  it('filters by assignee, unassigned and me', () => {
    expect(
      filterTickets(list, { assignee: 'sam@x.test' }, 'maya@x.test').map((x) => x.key),
    ).toEqual(['A-2']);
    expect(filterTickets(list, { assignee: '__none' }, 'maya@x.test').map((x) => x.key)).toEqual([
      'A-3',
    ]);
    expect(filterTickets(list, { assignee: '__me' }, 'maya@x.test').map((x) => x.key)).toEqual([
      'A-1',
    ]);
  });
  it('filters by label', () => {
    expect(filterTickets(list, { label: 'ui' }, 'm').map((x) => x.key)).toEqual(['A-2']);
  });
  it('matches the text against the key and the title, ignoring case', () => {
    expect(filterTickets(list, { q: 'CHECK' }, 'm').map((x) => x.key)).toEqual(['A-1']);
    expect(filterTickets(list, { q: 'a-3' }, 'm').map((x) => x.key)).toEqual(['A-3']);
  });
});

describe('filters in the URL', () => {
  it('round-trips and leaves other params alone', () => {
    const base = new URLSearchParams('t=A-1');
    const next = writeFilters(base, { assignee: '__me', label: 'ui', q: '' });
    expect(next.get('t')).toBe('A-1');
    expect(readFilters(next)).toEqual({ assignee: '__me', label: 'ui', q: '' });
    expect(next.has('q')).toBe(false);
  });
});

describe('boardLabels', () => {
  it('lists each label once, sorted', () => {
    expect(boardLabels(list)).toEqual(['email', 'payments', 'ui']);
  });
});
