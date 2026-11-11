import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { Board, Retro, Sprint, Ticket } from '@officepm/shared';
import { PriorityMark } from '@/components/priority-mark';
import { StatusPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/alert';
import { BurndownChart } from '@/features/overview/burndown-chart';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { errorMessage } from '@/lib/api';
import { burndownQuery, useSetTicketSprint, useUpdateSprint } from './api';
import { MoveSelect } from './move-select';
import { sprintStats } from './sprint-plan';

interface Props {
  projectSlug: string;
  board: Board;
  sprint: Sprint;
  /** Every sprint on the board, so a ticket can be moved to another. */
  sprints: Sprint[];
  tickets: Ticket[];
  retro: Retro | undefined;
  definitionOfReady: string[];
}

export function SprintCard({
  projectSlug,
  board,
  sprint,
  sprints,
  tickets,
  retro,
  definitionOfReady,
}: Props) {
  const titleId = useId();
  const update = useUpdateSprint(sprint.id);
  const move = useSetTicketSprint();
  const { open } = useTicketDrawer();
  const [gate, setGate] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const stats = sprintStats(tickets, sprint.id, board);
  const inSprint = tickets.filter((t) => t.sprint_id === sprint.id);
  const ready = definitionOfReady.every((item) => ticked.has(item));
  const showBurndown = sprint.status === 'active' || sprint.status === 'completed';
  const burndown = useQuery({ ...burndownQuery(sprint.id), enabled: showBurndown });

  const toggle = (item: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(item);
      else next.delete(item);
      return next;
    });

  const activate = () => update.mutate({ status: 'active' }, { onSuccess: () => setGate(false) });

  return (
    <Card aria-labelledby={titleId} className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="m-0 text-[15px] font-semibold">
          {sprint.name}
        </h3>
        <Badge>{sprint.status}</Badge>
      </div>
      <p className="my-1.5 text-dim">
        {stats.total} {stats.total === 1 ? 'ticket' : 'tickets'}
        {board.points && ` · ${stats.points} pt`}
        {sprint.start_date && ` · ${sprint.start_date} to ${sprint.end_date ?? '?'}`}
        {' · '}
        {stats.percent}%
      </p>
      <div
        role="progressbar"
        aria-label={`${sprint.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={stats.percent}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full bg-ok" style={{ width: `${stats.percent}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {sprint.status === 'planned' && (
          <Button onClick={() => setGate(true)} aria-expanded={gate}>
            Activate
          </Button>
        )}
        {sprint.status === 'active' && (
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({ status: 'completed' })}
          >
            Mark completed
          </Button>
        )}
        {sprint.status === 'completed' &&
          (retro ? (
            <Button asChild>
              <Link to={`/projects/${projectSlug}/boards/${board.slug}/retros/${retro.id}`}>
                View retro
              </Link>
            </Button>
          ) : (
            <span className="text-dim">Retro is being created...</span>
          ))}
      </div>
      {update.isError && <ErrorAlert className="mt-2">{errorMessage(update.error)}</ErrorAlert>}

      {gate && (
        <fieldset className="mt-3 rounded-md border border-line bg-bg p-3">
          <legend className="px-1 font-semibold">Definition of Ready</legend>
          <p className="mt-0 mb-2 text-dim">
            The board's checklist for taking work into a sprint. It is a gate for this action and is
            not saved per sprint.
          </p>
          {definitionOfReady.length === 0 && (
            <p className="text-dim">No Definition of Ready is set for this board.</p>
          )}
          {definitionOfReady.map((item) => (
            <label key={item} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={ticked.has(item)}
                onChange={(e) => toggle(item, e.target.checked)}
              />
              {item}
            </label>
          ))}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" disabled={!ready || update.isPending} onClick={activate}>
              Confirm activate
            </Button>
            <Button variant="ghost" onClick={() => setGate(false)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}

      {showBurndown && burndown.data && !burndown.data.insufficient_dates && (
        <div className="mt-3 max-w-[640px]">
          <BurndownChart points={burndown.data.points} totalScope={burndown.data.total_scope} />
        </div>
      )}
      {showBurndown && burndown.data?.insufficient_dates && (
        <p className="mt-2 text-dim">Set a start and end date on this sprint to see a burndown.</p>
      )}

      {inSprint.length > 0 && (
        <details open={sprint.status !== 'completed'} className="mt-3">
          <summary className="cursor-pointer text-dim">
            Tickets in {sprint.name} ({inSprint.length})
          </summary>
          <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
            {inSprint.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center gap-2 py-1.5">
                <button
                  type="button"
                  onClick={() => open(t.key)}
                  className="inline-flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent sm:w-auto sm:flex-1"
                >
                  <span className="shrink-0 font-mono text-xs">{t.key}</span>
                  <PriorityMark priority={t.priority} />
                  <span className="min-w-0 truncate">{t.title}</span>
                </button>
                {board.points && t.points != null && (
                  <span className="text-xs text-dim">{t.points} pt</span>
                )}
                <StatusPill status={t.status} />
                {sprint.status !== 'completed' && (
                  <MoveSelect
                    label={`Move ${t.key}`}
                    prompt="Move to..."
                    sprints={sprints}
                    currentId={sprint.id}
                    disabled={move.isPending}
                    onPick={(sprintId) => move.mutate({ key: t.key, sprintId })}
                  />
                )}
              </li>
            ))}
          </ul>
          {move.isError && <ErrorAlert className="mt-2">{errorMessage(move.error)}</ErrorAlert>}
        </details>
      )}
    </Card>
  );
}
