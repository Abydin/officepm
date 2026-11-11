import { EmptyState } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/status-pill';
import { useBoardFrame } from '@/features/projects/board-frame-context';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { epicRows } from './epic-progress';

/** Every epic on the board with how much of it is done. Each opens in the drawer. */
export function EpicsPage() {
  const { board, tickets } = useBoardFrame();
  const { open } = useTicketDrawer();

  if (!tickets) {
    return (
      <div role="status" aria-label="Loading epics" className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  const rows = epicRows(tickets, board);
  if (rows.length === 0) {
    return (
      <EmptyState title="No epics on this board yet">
        Set a ticket's level to epic in its drawer, then point other tickets at it as their parent.
      </EmptyState>
    );
  }

  return (
    <ul className="m-0 list-none space-y-4 p-0">
      {rows.map(({ epic, children, done, total, percent }) => (
        <li key={epic.key}>
          <Card aria-label={`${epic.key} ${epic.title}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => open(epic.key)}
                className="inline-flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent"
              >
                <strong className="font-mono">{epic.key}</strong>
                <span className="truncate">{epic.title}</span>
              </button>
              <span className="text-dim">
                {done} of {total} done
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${epic.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
            >
              <div className="h-full bg-ok" style={{ width: `${percent}%` }} />
            </div>
            {children.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-dim">
                  {children.length} {children.length === 1 ? 'ticket' : 'tickets'} in this epic
                </summary>
                <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
                  {children.map((child) => (
                    <li key={child.key} className="flex items-center gap-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => open(child.key)}
                        className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent"
                      >
                        <span className="shrink-0 font-mono text-xs">{child.key}</span>
                        <span className="min-w-0 truncate">{child.title}</span>
                      </button>
                      <StatusPill status={child.status} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}
