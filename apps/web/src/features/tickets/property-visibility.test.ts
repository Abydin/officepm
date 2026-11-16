import { FLOW_IDS, type Board, type FlowId } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { makeTicket } from '@/test/fixtures';
import { propertyVisibility, type PropertyId } from './property-visibility';

type BoardFacts = Pick<Board, 'flow' | 'points' | 'agile'>;

/** What each flow's boards expose today: points per the flow table, the agile switch is separate. */
const boardOf = (flow: FlowId, agile: boolean): BoardFacts => ({
  flow,
  agile,
  points: flow === 'scrum' || flow === 'scrumban',
});

const ALWAYS_APPLICABLE: PropertyId[] = ['priority', 'due', 'qa_owner', 'epic', 'labels', 'people'];

const run = (
  flow: FlowId,
  over: Parameters<typeof makeTicket>[0] = {},
  options: { agile?: boolean; pipelineTags?: boolean; revealed?: PropertyId[] } = {},
) =>
  propertyVisibility({
    board: boardOf(flow, options.agile ?? false),
    ticket: makeTicket(over),
    pipelineTags: options.pipelineTags ?? false,
    revealed: new Set(options.revealed ?? []),
  });

describe('propertyVisibility: a fresh ticket', () => {
  it.each(FLOW_IDS)('shows nothing on a %s board, and offers what applies to it', (flow) => {
    const { shown, addable } = run(flow);
    expect(shown).toEqual([]);
    const expected: PropertyId[] = [...ALWAYS_APPLICABLE];
    if (flow === 'scrum' || flow === 'scrumban' || flow === 'shapeup' || flow === 'waterfall') {
      expected.push('timebox');
    }
    if (flow === 'scrum' || flow === 'scrumban') expected.push('points');
    if (flow === 'shapeup') expected.push('appetite');
    expect([...addable].sort()).toEqual(expected.sort());
  });

  it('offers Level and Blocked only on an agile board', () => {
    expect(run('kanban').addable).not.toContain('level');
    expect(run('kanban').addable).not.toContain('blocked');
    expect(run('kanban', {}, { agile: true }).addable).toEqual(
      expect.arrayContaining(['level', 'blocked']),
    );
  });

  it('offers the pipeline tags only where the ticket sits under a feature on a pipeline', () => {
    expect(run('kanban').addable).not.toContain('phase');
    expect(run('kanban').addable).not.toContain('team_lane');
    expect(run('kanban', {}, { pipelineTags: true }).addable).toEqual(
      expect.arrayContaining(['phase', 'team_lane']),
    );
  });
});

describe('propertyVisibility: a filled ticket', () => {
  it.each(FLOW_IDS)('shows every filled property that applies on a %s board', (flow) => {
    const { shown, addable } = run(
      flow,
      {
        priority: 'high',
        due_date: '2030-01-01',
        qa_owner: 'sam@officepm.demo',
        sprint_id: 's1',
        points: 3,
        appetite: '2 weeks',
        level: 'story',
        parent_key: 'FOOD-ENG-1',
        labels: ['ui'],
        participants: [{ id: 2, name: 'Sam', department: null, role: null }],
        blocked: true,
        phase: 'Design',
        department: 'Backend',
      },
      { agile: true, pipelineTags: true },
    );
    const expected: PropertyId[] = [...ALWAYS_APPLICABLE, 'level', 'blocked', 'phase', 'team_lane'];
    if (flow !== 'kanban') expected.push('timebox');
    if (flow === 'scrum' || flow === 'scrumban') expected.push('points');
    if (flow === 'shapeup') expected.push('appetite');
    expect([...shown].sort()).toEqual(expected.sort());
    expect(addable).toEqual([]);
  });

  it('keeps a value that does not apply to the board out of sight', () => {
    // Points on a kanban board: hidden today, so hidden still.
    expect(run('kanban', { points: 5, appetite: '1 week', sprint_id: 's1' }).shown).toEqual([]);
  });

  it('treats zero points as a value, and an empty label list as none', () => {
    expect(run('scrum', { points: 0 }).shown).toEqual(['points']);
    expect(run('scrum', { labels: [] }).shown).toEqual([]);
  });
});

describe('propertyVisibility: revealing', () => {
  it('shows a revealed empty property and stops offering it', () => {
    const { shown, addable } = run('kanban', {}, { revealed: ['priority'] });
    expect(shown).toEqual(['priority']);
    expect(addable).not.toContain('priority');
  });

  it('ignores a revealed property that does not apply', () => {
    expect(run('kanban', {}, { revealed: ['points'] }).shown).toEqual([]);
  });

  it('lists shown properties in one fixed order, whatever order they were revealed in', () => {
    const a = run('scrum', {}, { revealed: ['labels', 'priority', 'due'] }).shown;
    const b = run('scrum', {}, { revealed: ['due', 'labels', 'priority'] }).shown;
    expect(a).toEqual(['priority', 'due', 'labels']);
    expect(b).toEqual(a);
  });
});
