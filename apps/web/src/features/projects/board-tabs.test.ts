import { FLOW_IDS } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { boardTabs } from './board-tabs';

const labels = (flow: (typeof FLOW_IDS)[number], agile: boolean) =>
  boardTabs({ flow, agile }).map((t) => t.label);

describe('boardTabs', () => {
  it('always starts with the board view', () => {
    for (const flow of FLOW_IDS)
      expect(boardTabs({ flow, agile: false })[0]).toMatchObject({ id: 'board', path: '' });
  });

  it('gives a Kanban board only the board view', () => {
    expect(labels('kanban', false)).toEqual(['Board']);
  });

  it('names the time-box view after the flow', () => {
    expect(labels('scrum', false)).toEqual(['Board', 'Backlog']);
    expect(labels('shapeup', false)).toEqual(['Board', 'Cycles']);
    expect(labels('waterfall', false)).toEqual(['Board', 'Phases']);
  });

  it('adds the agile views only on agile boards, and retros only where there are sprints', () => {
    expect(labels('scrum', true)).toEqual(['Board', 'Backlog', 'Epics', 'Retros', 'Standup']);
    expect(labels('scrumban', true)).toEqual(['Board', 'Backlog', 'Epics', 'Retros', 'Standup']);
    expect(labels('kanban', true)).toEqual(['Board', 'Epics', 'Standup']);
    expect(labels('waterfall', true)).toEqual(['Board', 'Phases', 'Epics', 'Standup']);
  });
});
