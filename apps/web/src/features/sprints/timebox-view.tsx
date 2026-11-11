import { useQuery } from '@tanstack/react-query';
import { PriorityMark } from '@/components/priority-mark';
import { StatusPill } from '@/components/status-pill';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardFrame } from '@/features/projects/board-frame-context';
import { retrosQuery } from '@/features/retros/api';
import { sprintsQuery } from '@/features/tickets/api';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { errorMessage } from '@/lib/api';
import { boardSettingsQuery, useSetTicketSprint, velocityQuery } from './api';
import { MoveSelect } from './move-select';
import { PhaseStrip } from './phase-strip';
import { SprintCard } from './sprint-card';
import { SprintForm } from './sprint-form';
import { sprintNoun } from './sprint-plan';

const th = 'px-3 py-2 font-medium';

/**
 * The Backlog tab on Scrum and Scrumban boards, Cycles on Shape Up, Phases on
 * Waterfall: the time-boxes, with their tickets, and the tickets that are in none.
 * One view for all of them, because the server models all of them as sprints.
 */
export function TimeboxView() {
  const { projectSlug, board, tickets } = useBoardFrame();
  const sprints = useQuery(sprintsQuery(projectSlug, board.slug));
  const settings = useQuery(boardSettingsQuery(projectSlug, board.slug));
  const retros = useQuery(retrosQuery(projectSlug, board.slug));
  const velocity = useQuery({
    ...velocityQuery(projectSlug, board.slug),
    enabled: board.flow === 'scrumban',
  });
  const move = useSetTicketSprint();
  const { open } = useTicketDrawer();
  const noun = sprintNoun(board.flow);

  if (sprints.isError || settings.isError) {
    return <ErrorAlert>{errorMessage(sprints.error ?? settings.error)}</ErrorAlert>;
  }
  if (!sprints.data || !settings.data || !tickets) {
    return (
      <div role="status" aria-label={`Loading ${noun.toLowerCase()}s`} className="space-y-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const loose = tickets.filter((t) => !t.sprint_id);
  const loosePoints = loose.reduce((sum, t) => sum + (t.points ?? 0), 0);
  const retroFor = (sprintId: string) => retros.data?.find((r) => r.sprint_id === sprintId);

  return (
    <>
      {board.flow === 'waterfall' && <PhaseStrip board={board} tickets={tickets} />}

      {velocity.data && (
        <Card aria-label="Velocity" className="mb-4">
          <strong>Velocity</strong>
          <p className="mt-1 mb-0 text-dim">
            {velocity.data.average_velocity === null
              ? 'Not enough completed sprints yet.'
              : `Average ${velocity.data.average_velocity} ${velocity.data.uses_points ? 'points' : 'tickets'} completed per sprint, across ${velocity.data.sprints.length} completed ${velocity.data.sprints.length === 1 ? 'sprint' : 'sprints'}.`}
          </p>
        </Card>
      )}

      <h2 className="mt-0 mb-3 text-[15px] font-semibold">{noun}s</h2>
      <SprintForm projectSlug={projectSlug} board={board} />
      {sprints.data.length === 0 && (
        <EmptyState title={`No ${noun.toLowerCase()}s yet`} className="mb-4">
          Name one above to start planning. Its dates are filled in for you.
        </EmptyState>
      )}
      {sprints.data.map((sprint) => (
        <SprintCard
          key={sprint.id}
          projectSlug={projectSlug}
          board={board}
          sprint={sprint}
          sprints={sprints.data}
          tickets={tickets}
          retro={retroFor(sprint.id)}
          definitionOfReady={settings.data.definition_of_ready}
        />
      ))}

      <h2 className="mt-6 mb-3 text-[15px] font-semibold">
        Unscheduled backlog ({loose.length}
        {board.points && ` · ${loosePoints} pt`})
      </h2>
      {move.isError && <ErrorAlert className="mb-2">{errorMessage(move.error)}</ErrorAlert>}
      {loose.length === 0 ? (
        <EmptyState title="Every ticket is in a time-box">
          Nothing is waiting to be planned.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-raised">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs text-dim">
                <th scope="col" className={th}>
                  Ticket
                </th>
                <th scope="col" className={th}>
                  Type
                </th>
                {board.points && (
                  <th scope="col" className={th}>
                    Points
                  </th>
                )}
                <th scope="col" className={th}>
                  Status
                </th>
                <th scope="col" className={th}>
                  Plan
                </th>
              </tr>
            </thead>
            <tbody>
              {loose.map((t) => (
                <tr key={t.key} className="border-b border-line last:border-b-0 hover:bg-hover">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => open(t.key)}
                      className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent"
                    >
                      <span className="font-mono text-xs">{t.key}</span>
                      <PriorityMark priority={t.priority} />
                      {t.title}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-dim">{t.type}</td>
                  {board.points && <td className="px-3 py-2">{t.points ?? ''}</td>}
                  <td className="px-3 py-2">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-3 py-2">
                    <MoveSelect
                      label={`Add ${t.key} to a sprint`}
                      prompt="Choose a sprint"
                      sprints={sprints.data}
                      currentId={null}
                      disabled={move.isPending}
                      onPick={(sprintId) => move.mutate({ key: t.key, sprintId })}
                    />
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
