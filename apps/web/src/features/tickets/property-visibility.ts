import { flowSupports, type Board, type Ticket } from '@officepm/shared';

/** The properties that live in the ticket sidebar. Status and Assignee are not here: they always show. */
export const PROPERTY_IDS = [
  'priority',
  'due',
  'qa_owner',
  'timebox',
  'points',
  'appetite',
  'level',
  'epic',
  'labels',
  'people',
  'blocked',
  'phase',
  'team_lane',
] as const;
export type PropertyId = (typeof PROPERTY_IDS)[number];

type BoardFacts = Pick<Board, 'flow' | 'points' | 'agile'>;
type TicketFacts = Pick<
  Ticket,
  | 'priority'
  | 'due_date'
  | 'qa_owner'
  | 'sprint_id'
  | 'points'
  | 'appetite'
  | 'level'
  | 'parent_key'
  | 'labels'
  | 'participants'
  | 'blocked'
  | 'phase'
  | 'department'
>;

export interface VisibilityInput {
  board: BoardFacts;
  ticket: TicketFacts;
  /** The ticket is not an epic and sits under a feature on a pipeline, or already carries a phase or lane. */
  pipelineTags: boolean;
  /** Properties the person opened with "+ Add property" in this session, so they stay on screen while empty. */
  revealed: ReadonlySet<PropertyId>;
}

/** Today's gating: a property exists on a board only where the flow or the agile switch gives it. */
function applies(id: PropertyId, { board, pipelineTags }: VisibilityInput): boolean {
  switch (id) {
    case 'timebox':
      return (
        flowSupports(board.flow, 'sprints') ||
        flowSupports(board.flow, 'cycles') ||
        flowSupports(board.flow, 'phases')
      );
    case 'points':
      return board.points;
    case 'appetite':
      return board.flow === 'shapeup';
    case 'level':
    case 'blocked':
      return board.agile;
    case 'phase':
    case 'team_lane':
      return pipelineTags;
    default:
      return true;
  }
}

function hasValue(id: PropertyId, { ticket }: VisibilityInput): boolean {
  switch (id) {
    case 'priority':
      return Boolean(ticket.priority);
    case 'due':
      return Boolean(ticket.due_date);
    case 'qa_owner':
      return Boolean(ticket.qa_owner);
    case 'timebox':
      return Boolean(ticket.sprint_id);
    case 'points':
      return ticket.points != null;
    case 'appetite':
      return Boolean(ticket.appetite);
    case 'level':
      return Boolean(ticket.level);
    case 'epic':
      return Boolean(ticket.parent_key);
    case 'labels':
      return ticket.labels.length > 0;
    case 'people':
      return (ticket.participants ?? []).length > 0;
    case 'blocked':
      return ticket.blocked;
    case 'phase':
      return Boolean(ticket.phase);
    case 'team_lane':
      return Boolean(ticket.department);
  }
}

/**
 * Which sidebar properties to show, and which to offer under "+ Add property". A property
 * shows when it applies to the board and has a value or was revealed; one that applies but
 * is empty and not revealed is offered instead. Both lists keep PROPERTY_IDS order, so rows
 * never jump around as they are revealed.
 */
export function propertyVisibility(input: VisibilityInput): {
  shown: PropertyId[];
  addable: PropertyId[];
} {
  const shown: PropertyId[] = [];
  const addable: PropertyId[] = [];
  for (const id of PROPERTY_IDS) {
    if (!applies(id, input)) continue;
    (hasValue(id, input) || input.revealed.has(id) ? shown : addable).push(id);
  }
  return { shown, addable };
}
