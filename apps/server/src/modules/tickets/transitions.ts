import { flowSupports } from '@officepm/shared';
import type { BoardConfig } from '../../projects-config.js';

/**
 * Why a status change is not allowed on this board, or null when it is. Waterfall
 * phases are sequential (PRD 17 open question 4): going forward may not skip a
 * phase, moving back is always allowed. v1 applies this to exactly the flows whose
 * capability table says they run in phases. One rule for every way a ticket moves:
 * the PATCH route and the GitHub webhooks both call it.
 */
export function transitionViolation(
  board: Pick<BoardConfig, 'flow' | 'statuses'>,
  from: string,
  to: string,
): string | null {
  if (!flowSupports(board.flow, 'phases') || to === from) return null;
  const { statuses } = board;
  const oldIdx = statuses.indexOf(from);
  const newIdx = statuses.indexOf(to);
  if (newIdx <= oldIdx + 1) return null;
  return (
    'Waterfall boards are sequential only (PRD 17.4): move through "' +
    statuses[oldIdx + 1] +
    '" first, this board does not allow skipping ahead to "' +
    to +
    '"'
  );
}
