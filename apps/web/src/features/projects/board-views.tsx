import { EmptyState } from '@/components/ui/alert';
import { StatusDot } from '@/components/status-dot';
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

/**
 * The board tab. Real columns and drag and drop are phase 3b; until then it
 * shows what the board will be made of, with live counts per status.
 */
export function BoardView() {
  const { board, tickets } = useBoardFrame();
  const count = (status: string) => tickets?.filter((t) => t.status === status).length ?? 0;

  return (
    <>
      <p className="mt-0 mb-3 rounded-md border border-dashed border-line-strong px-3 py-2 text-[13px] text-dim">
        Placeholder: the draggable columns and the ticket drawer arrive in phase 3b. These counts
        are live.
      </p>
      <ul className="m-0 flex list-none gap-3 overflow-x-auto p-0 pb-2">
        {board.statuses.map((status) => {
          const limit = board.wip_limits[status];
          const n = count(status);
          const over = limit !== undefined && n > limit;
          return (
            <li key={status} className="min-w-[200px] flex-1 basis-0 rounded-xl bg-lane p-2">
              <div className="flex items-center gap-2 px-1.5 pt-1 pb-2.5 text-xs font-semibold tracking-[0.05em] uppercase">
                <StatusDot status={status} />
                <span className="min-w-0 flex-1 truncate">{status}</span>
                <span
                  className={`rounded-full px-1.5 font-mono text-[11px] leading-[18px] ${over ? 'bg-err-soft text-err' : 'bg-hover text-dim'}`}
                  title={over ? 'Over the WIP limit' : undefined}
                >
                  {n}
                  {limit !== undefined ? `/${limit}` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
