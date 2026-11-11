import { EmptyState } from '@/components/ui/alert';
import { useBoardFrame } from './board-frame-context';
import { boardTabs, type BoardTabId } from './board-tabs';

/**
 * Placeholder for a view a later phase builds. It says which view and which
 * phase, and refuses (rather than pretends) when the board's flow has no such view.
 */
export function ViewPlaceholder({ view }: { view: BoardTabId }) {
  const { board } = useBoardFrame();
  const tab = boardTabs(board).find((t) => t.id === view);

  if (!tab) {
    return (
      <EmptyState title="Not available on this board">
        A {board.flow} board without the agile layer has no {view} view.
      </EmptyState>
    );
  }
  return (
    <EmptyState title={`${tab.label} is not built yet`}>
      This view arrives in phase {tab.phase} of the v2 rewrite. The v1 client still has it.
    </EmptyState>
  );
}
