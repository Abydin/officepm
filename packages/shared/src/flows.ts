import { z } from 'zod';

/** The five workflows a board can declare (PRD 6.8). */
export const FLOW_IDS = ['kanban', 'scrum', 'scrumban', 'shapeup', 'waterfall'] as const;
export const FlowIdSchema = z.enum(FLOW_IDS);
export type FlowId = z.infer<typeof FlowIdSchema>;

/** 'optional' only occurs for story points on scrumban. */
export type Support = 'yes' | 'no' | 'optional';

export interface FlowCapabilities {
  sprints: boolean;
  wipLimits: boolean;
  points: Support;
  cycles: boolean;
  phases: boolean;
}

/** PRD 6.8, row for row. The UI adapts to a board's flow using this table. */
export const FLOW_CAPABILITIES: Readonly<Record<FlowId, FlowCapabilities>> = {
  kanban: { sprints: false, wipLimits: true, points: 'no', cycles: false, phases: false },
  scrum: { sprints: true, wipLimits: false, points: 'yes', cycles: false, phases: false },
  scrumban: { sprints: true, wipLimits: true, points: 'optional', cycles: false, phases: false },
  shapeup: { sprints: false, wipLimits: false, points: 'no', cycles: true, phases: false },
  waterfall: { sprints: false, wipLimits: false, points: 'no', cycles: false, phases: true },
};

/** The time-box kinds stored in `sprints.kind`. */
export const SPRINT_KINDS = ['sprint', 'cycle', 'cooldown', 'phase'] as const;
export const SprintKindSchema = z.enum(SPRINT_KINDS);
export type SprintKind = z.infer<typeof SprintKindSchema>;

/**
 * Which `sprints.kind` values v1 accepts on a board of each flow. Taken from the
 * v1 server, not the PRD table: v1 lets kanban and scrumban boards create plain
 * sprints, even though PRD 6.8 says kanban has none. Kept as v1 behaves because
 * the conformance suite is the contract.
 */
export const ALLOWED_SPRINT_KINDS: Readonly<Record<FlowId, readonly SprintKind[]>> = {
  kanban: ['sprint'],
  scrum: ['sprint'],
  scrumban: ['sprint'],
  shapeup: ['cycle', 'cooldown'],
  waterfall: ['phase'],
};

/** Default length in days of each kind when only a start date is given. */
export const DEFAULT_SPRINT_DAYS: Readonly<Record<SprintKind, number>> = {
  sprint: 14,
  cycle: 42,
  cooldown: 14,
  phase: 14,
};

export function flowSupports(flow: FlowId, capability: keyof FlowCapabilities): boolean {
  const value = FLOW_CAPABILITIES[flow][capability];
  return value === true || value === 'yes' || value === 'optional';
}
