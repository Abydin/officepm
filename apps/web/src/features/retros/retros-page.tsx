import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardFrame } from '@/features/projects/board-frame-context';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { retrosQuery } from './api';

/** The board's retros, newest first. Each one opens on its own address, so it can be linked to. */
export function RetrosPage() {
  const { projectSlug, board } = useBoardFrame();
  const retros = useQuery(retrosQuery(projectSlug, board.slug));

  if (retros.isError) return <ErrorAlert>{errorMessage(retros.error)}</ErrorAlert>;
  if (!retros.data) {
    return (
      <div role="status" aria-label="Loading retros" className="space-y-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (retros.data.length === 0) {
    return (
      <EmptyState title="No retros yet">
        One is created for you when a sprint is marked completed.
      </EmptyState>
    );
  }

  return (
    <ul className="m-0 list-none divide-y divide-line rounded-lg border border-line bg-raised p-0">
      {retros.data.map((retro) => (
        <li key={retro.id} className="flex items-center gap-3 px-3 py-2.5">
          <Link
            to={`/projects/${projectSlug}/boards/${board.slug}/retros/${retro.id}`}
            className="min-w-0 flex-1 truncate text-accent"
          >
            {retro.name}
          </Link>
          <Badge>{retro.status}</Badge>
          <span className="text-xs text-dim">{timeAgo(retro.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
