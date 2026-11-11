import { Avatar } from '@/components/avatar';
import { StatusPill } from '@/components/status-pill';
import { EmptyState } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardFrame } from '@/features/projects/board-frame-context';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { timeAgo } from '@/lib/format';
import { standupGroups } from './standup-groups';

/** Built from ticket status and recent change, with nothing to type: who has what, what is stuck. */
export function StandupPage() {
  const { tickets } = useBoardFrame();
  const { open } = useTicketDrawer();

  if (!tickets) {
    return (
      <div role="status" aria-label="Loading standup" className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (tickets.length === 0) {
    return (
      <EmptyState title="Nothing to report">
        Tickets on this board show up here by person.
      </EmptyState>
    );
  }

  return (
    <>
      <p className="mt-0 mb-4 text-dim">
        Built from each ticket's status and when it last changed. Nothing to type in.
      </p>
      <div className="space-y-3">
        {standupGroups(tickets).map((group) => (
          <Card key={group.assignee ?? 'unassigned'} aria-label={group.name}>
            <h2 className="m-0 mb-2 flex items-center gap-2 text-[15px] font-semibold">
              <Avatar who={group.assignee} decorative />
              {group.name}
            </h2>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {group.tickets.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <button
                    type="button"
                    onClick={() => open(t.key)}
                    className="inline-flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent"
                  >
                    <span className="font-mono text-xs">{t.key}</span>
                    <span>{t.title}</span>
                  </button>
                  <StatusPill status={t.status} />
                  {t.blocked && (
                    <span className="text-err">
                      Blocked: {t.blocker_reason || 'no reason given'}
                    </span>
                  )}
                  <span className="text-xs text-dim">updated {timeAgo(t.updated_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
