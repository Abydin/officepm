import { describe, expect, it } from 'vitest';
import { designBoard, makeTicket } from '@/test/fixtures';
import {
  addDays,
  defaultKind,
  kindsFor,
  moveTargets,
  sprintNoun,
  sprintStats,
  timeboxEnd,
} from './sprint-plan';

describe('sprint-plan', () => {
  it('names the time-box after the flow', () => {
    expect(sprintNoun('scrum')).toBe('Sprint');
    expect(sprintNoun('scrumban')).toBe('Sprint');
    expect(sprintNoun('shapeup')).toBe('Cycle');
    expect(sprintNoun('waterfall')).toBe('Phase');
  });

  it('offers the kinds the server allows, defaulting to the first', () => {
    expect(kindsFor('shapeup')).toEqual(['cycle', 'cooldown']);
    expect(defaultKind('shapeup')).toBe('cycle');
    expect(kindsFor('waterfall')).toEqual(['phase']);
    expect(defaultKind('scrum')).toBe('sprint');
  });

  it('ends a time-box after its default length, counted in UTC days', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(timeboxEnd('2026-01-01', 'sprint')).toBe('2026-01-15');
    expect(timeboxEnd('2026-01-01', 'cycle')).toBe('2026-02-12');
    expect(timeboxEnd('2026-01-01', 'cooldown')).toBe('2026-01-15');
  });

  it('counts a sprint by tickets, and by points when the board has them', () => {
    const board = { ...designBoard, done_statuses: ['Done'] };
    const tickets = [
      makeTicket({ key: 'A-1', sprint_id: 's', status: 'Done', points: 3 }),
      makeTicket({ key: 'A-2', sprint_id: 's', status: 'In Progress', points: 5 }),
      makeTicket({ key: 'A-3', sprint_id: 'other', status: 'Done', points: 8 }),
    ];
    expect(sprintStats(tickets, 's', board)).toEqual({
      total: 2,
      done: 1,
      points: 8,
      percent: 50,
    });
    expect(sprintStats([], 's', board).percent).toBe(0);
  });

  it('moves a ticket only into planned or active time-boxes other than its own', () => {
    const sprints = [
      { id: 'a', status: 'planned' },
      { id: 'b', status: 'active' },
      { id: 'c', status: 'completed' },
    ];
    expect(moveTargets(sprints, 'a').map((s) => s.id)).toEqual(['b']);
    expect(moveTargets(sprints, null).map((s) => s.id)).toEqual(['a', 'b']);
  });
});
