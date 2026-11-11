import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { timeAgo } from '@/lib/format';
import { unreadHandoffsQuery, useMarkHandoffsRead } from './api';

/** How many handoffs addressed to me are unread. Zero until the list has loaded. */
export function useUnreadHandoffCount(): number {
  return useQuery(unreadHandoffsQuery).data?.length ?? 0;
}

/** "3 unread handoffs", for a link's accessible name. */
export const unreadLabel = (count: number) => `${count} unread handoff${count === 1 ? '' : 's'}`;

/**
 * What other people handed to me and I have not read: a ticket assigned to me, or one
 * sent to my department. Opening the ticket reads it, or it can be marked read on
 * its own. Renders nothing when there is nothing unread.
 */
export function HandoffInbox() {
  const unread = useQuery(unreadHandoffsQuery);
  const markRead = useMarkHandoffsRead();
  const { open } = useTicketDrawer();
  const notices = unread.data ?? [];
  if (notices.length === 0) return null;

  return (
    <section aria-labelledby="handed-to-you" className="mb-6">
      <h2 id="handed-to-you" className="m-0 mb-2 text-[15px] font-semibold">
        Handed to you
      </h2>
      <ul className="m-0 list-none space-y-2 p-0">
        {notices.map((n) => (
          <li key={n.id} className="rounded-lg border border-accent bg-accent-soft p-3">
            <p className="m-0">
              <strong>{n.from_name}</strong>{' '}
              {n.decision === 'approve' ? 'handed over' : 'sent back'}{' '}
              <span className="font-mono text-xs">{n.ticket_key}</span> {n.ticket_title}
              <span className="text-dim">
                {' '}
                from {n.from_status} to {n.to_status} · {timeAgo(n.created_at)}
              </span>
            </p>
            {(n.decision === 'reject' ? n.reason : n.note) && (
              <p className="m-0 mt-1 break-words whitespace-pre-wrap">
                {n.decision === 'reject' ? n.reason : n.note}
              </p>
            )}
            {n.decision === 'reject' && n.note && (
              <p className="m-0 mt-1 break-words whitespace-pre-wrap">{n.note}</p>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                aria-label={`Open ${n.ticket_key}`}
                onClick={() => open(n.ticket_key)}
              >
                Open
              </Button>
              <Button
                size="sm"
                aria-label={`Mark read ${n.ticket_key}`}
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(n.ticket_key)}
              >
                Mark read
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
