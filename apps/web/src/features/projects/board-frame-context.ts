import type { Board, Ticket } from '@officepm/shared';
import { useOutletContext } from 'react-router';

/** What the board frame hands to the view rendered under its tabs. */
export interface BoardFrameContext {
  projectSlug: string;
  board: Board;
  /** Undefined while the ticket list is still loading. */
  tickets: Ticket[] | undefined;
}

export function useBoardFrame(): BoardFrameContext {
  return useOutletContext<BoardFrameContext>();
}
