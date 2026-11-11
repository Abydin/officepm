import { useQuery } from '@tanstack/react-query';
import { PriorityMark } from '@/components/priority-mark';
import { DueChip } from '@/components/due-chip';
import { StatusPill } from '@/components/status-pill';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { myTicketsQuery } from '@/features/tickets/api';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { errorMessage } from '@/lib/api';

/** Every ticket assigned to the signed-in person, across boards. Each opens in the drawer. */
export function MyTicketsPage() {
  const tickets = useQuery(myTicketsQuery);
  const { open } = useTicketDrawer();

  return (
    <>
      <h1 className="m-0 mb-4 text-[22px] font-semibold">My Tickets</h1>
      {tickets.isError && <ErrorAlert>{errorMessage(tickets.error)}</ErrorAlert>}
      {tickets.isPending && (
        <div role="status" aria-label="Loading your tickets" className="space-y-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      )}
      {tickets.data?.length === 0 && (
        <EmptyState title="Nothing assigned to you">
          Tickets assigned to you show up here.
        </EmptyState>
      )}
      {tickets.data && tickets.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-raised">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs text-dim">
                <th scope="col" className="px-3 py-2 font-medium">
                  Key
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Title
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Board
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Due
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.data.map((t) => (
                <tr key={t.key} className="border-b border-line last:border-b-0 hover:bg-hover">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{t.key}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => open(t.key)}
                      className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent"
                    >
                      <PriorityMark priority={t.priority} />
                      {t.title}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-dim">
                    {t.project_slug}/{t.board_slug}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-3 py-2">
                    <DueChip date={t.due_date} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
