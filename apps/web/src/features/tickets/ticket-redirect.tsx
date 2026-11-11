import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router';
import { ErrorAlert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { ticketQuery } from './api';

/**
 * `#/t/KEY`: the short link to a ticket. It finds the ticket's board and
 * continues to that board with the drawer open.
 */
export function TicketRedirect() {
  const { key = '' } = useParams();
  const ticket = useQuery(ticketQuery(key));

  if (ticket.isError) {
    return (
      <>
        <ErrorAlert className="mb-4">{errorMessage(ticket.error)}</ErrorAlert>
        <Link to="/overview" className="text-accent">
          Back to the overview
        </Link>
      </>
    );
  }
  if (!ticket.data) return <Skeleton role="status" aria-label="Finding ticket" className="h-24" />;
  const { project_slug, board_slug } = ticket.data;
  return (
    <Navigate
      replace
      to={`/projects/${project_slug}/boards/${board_slug}?t=${encodeURIComponent(key)}`}
      state={{ drawer: false }}
    />
  );
}
