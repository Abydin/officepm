import { flowSupports, type Board } from '@officepm/shared';

export type BoardTabId = 'board' | 'backlog' | 'epics' | 'retros' | 'standup';

export interface BoardTab {
  id: BoardTabId;
  label: string;
  /** Path under the board route. Empty is the index route. */
  path: string;
  /** The phase that builds the real view; until then the tab shows a labelled placeholder. */
  phase: '3b' | '3c';
}

/**
 * The view tabs a board shows. They follow the board's flow and agile flag, the
 * same capability table the server uses (PRD 6.8): a Kanban board has no
 * backlog of sprints, a board without the agile layer has no epics or retros.
 */
export function boardTabs(board: Pick<Board, 'flow' | 'agile'>): BoardTab[] {
  const timeboxed =
    flowSupports(board.flow, 'sprints') ||
    flowSupports(board.flow, 'cycles') ||
    flowSupports(board.flow, 'phases');
  const backlogLabel =
    board.flow === 'shapeup' ? 'Cycles' : board.flow === 'waterfall' ? 'Phases' : 'Backlog';

  const tabs: BoardTab[] = [{ id: 'board', label: 'Board', path: '', phase: '3b' }];
  if (timeboxed) tabs.push({ id: 'backlog', label: backlogLabel, path: 'backlog', phase: '3b' });
  if (board.agile) tabs.push({ id: 'epics', label: 'Epics', path: 'epics', phase: '3c' });
  if (board.agile && flowSupports(board.flow, 'sprints'))
    tabs.push({ id: 'retros', label: 'Retros', path: 'retros', phase: '3c' });
  if (board.agile) tabs.push({ id: 'standup', label: 'Standup', path: 'standup', phase: '3c' });
  return tabs;
}
