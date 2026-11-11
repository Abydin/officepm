import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { boardQuery, boardTicketsQuery, useCreateTicket } from './api';
import { boardTabs } from './board-tabs';
import type { BoardFrameContext } from './board-frame-context';

/**
 * The page frame for one board: title, flow badges, ticket counts, a quick-add
 * form, and the view tabs. The view itself renders in the Outlet, so Board,
 * Backlog and the rest each own only their own body.
 */
export function BoardFrame() {
  const { slug = '', board: boardSlug = '' } = useParams();
  const board = useQuery(boardQuery(slug, boardSlug));
  const tickets = useQuery(boardTicketsQuery(slug, boardSlug));
  const createTicket = useCreateTicket();
  const [title, setTitle] = useState('');

  if (board.isError) {
    return (
      <>
        <ErrorAlert className="mb-4">{errorMessage(board.error)}</ErrorAlert>
        <Link to="/projects" className="text-accent">
          Back to projects
        </Link>
      </>
    );
  }
  if (!board.data) {
    return (
      <div role="status" aria-label="Loading board">
        <Skeleton className="mb-4 h-7 w-56" />
        <Skeleton className="mb-3 h-8" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const b = board.data;
  const doneCount = tickets.data?.filter((t) => b.done_statuses.includes(t.status)).length ?? 0;
  const tabs = boardTabs(b);
  const typeForNew = b.types[0];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !typeForNew) return;
    createTicket.mutate(
      { project_slug: slug, board_slug: boardSlug, title: trimmed, type: typeForNew },
      { onSuccess: () => setTitle('') },
    );
  };

  const context: BoardFrameContext = { projectSlug: slug, board: b, tickets: tickets.data };

  return (
    <div className="flex min-h-full flex-col">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-[22px] font-semibold">{b.name}</h1>
        <Badge>{b.flow}</Badge>
        {b.agile && <Badge>agile</Badge>}
        {b.has_github && <Badge>github</Badge>}
        <span className="font-mono text-dim">{b.prefix}</span>
        {tickets.data && (
          <span className="ml-auto text-dim">
            {tickets.data.length} tickets · {doneCount} done
          </span>
        )}
      </header>

      <form onSubmit={submit} className="mb-3 flex gap-2">
        <Input
          id="quick-add"
          aria-label="New ticket title"
          placeholder="New ticket title, press Enter"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" disabled={!title.trim() || createTicket.isPending}>
          <Plus className="size-4" aria-hidden="true" />
          Create
        </Button>
      </form>
      {createTicket.isError && (
        <ErrorAlert className="mb-3">{errorMessage(createTicket.error)}</ErrorAlert>
      )}
      {tickets.isError && (
        <ErrorAlert className="mb-3">
          Could not load tickets. {errorMessage(tickets.error)}
        </ErrorAlert>
      )}

      <nav
        aria-label="Board views"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.path}
            end
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 whitespace-nowrap no-underline',
                isActive
                  ? 'border-accent font-semibold text-accent'
                  : 'border-transparent text-dim hover:text-fg',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </div>
  );
}
