import { describe, expect, it } from 'vitest';
import {
  ALLOWED_SPRINT_KINDS,
  FLOW_CAPABILITIES,
  FLOW_IDS,
  FlowIdSchema,
  flowSupports,
} from './flows.js';

describe('flows', () => {
  it('has exactly the five PRD 6.8 flows', () => {
    expect([...FLOW_IDS]).toEqual(['kanban', 'scrum', 'scrumban', 'shapeup', 'waterfall']);
    expect(Object.keys(FLOW_CAPABILITIES).sort()).toEqual([...FLOW_IDS].sort());
  });

  it('matches the PRD 6.8 capability table', () => {
    expect(FLOW_CAPABILITIES).toEqual({
      kanban: { sprints: false, wipLimits: true, points: 'no', cycles: false, phases: false },
      scrum: { sprints: true, wipLimits: false, points: 'yes', cycles: false, phases: false },
      scrumban: {
        sprints: true,
        wipLimits: true,
        points: 'optional',
        cycles: false,
        phases: false,
      },
      shapeup: { sprints: false, wipLimits: false, points: 'no', cycles: true, phases: false },
      waterfall: { sprints: false, wipLimits: false, points: 'no', cycles: false, phases: true },
    });
  });

  it('treats optional points as supported', () => {
    expect(flowSupports('scrumban', 'points')).toBe(true);
    expect(flowSupports('kanban', 'points')).toBe(false);
    expect(flowSupports('shapeup', 'cycles')).toBe(true);
  });

  it('every flow allows at least one sprint kind', () => {
    for (const flow of FLOW_IDS) expect(ALLOWED_SPRINT_KINDS[flow].length).toBeGreaterThan(0);
  });

  it('rejects an unknown flow', () => {
    expect(FlowIdSchema.safeParse('lean').success).toBe(false);
  });
});
