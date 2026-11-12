import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { Board, Ticket } from '@officepm/shared';
import { StatusPill } from '@/components/status-pill';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { epicPipelineQuery, useAddFeatureTicket } from '@/features/pipeline/api';
import { PipelineStepper } from '@/features/pipeline/pipeline-stepper';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { errorMessage } from '@/lib/api';

/** Groups tickets by their team lane, keeping the order lanes first appeared in. */
function byLane(tickets: readonly Ticket[]): Array<[string, Ticket[]]> {
  const lanes = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const lane = t.department ?? '';
    lanes.set(lane, [...(lanes.get(lane) ?? []), t]);
  }
  return [...lanes.entries()];
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const { open } = useTicketDrawer();
  return (
    <li className="flex items-center gap-2 py-1.5">
      <button
        type="button"
        onClick={() => open(ticket.key)}
        className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-fg hover:text-accent"
      >
        <span className="shrink-0 font-mono text-xs">{ticket.key}</span>
        <span className="min-w-0 truncate">{ticket.title}</span>
      </button>
      <StatusPill status={ticket.status} />
    </li>
  );
}

/** Where a new ticket goes: the title, and the phase and team lane it is tagged with. */
function AddTicketForm({
  epic,
  board,
  phases,
  current,
  lanes,
}: {
  epic: Ticket;
  board: Board;
  phases: readonly { name: string; department: string | null }[];
  current: string;
  lanes: readonly string[];
}) {
  const add = useAddFeatureTicket();
  const ids = { title: useId(), phase: useId(), lane: useId(), lanes: useId() };
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState(current);
  const [lane, setLane] = useState('');
  const type = board.types.includes('task') ? 'task' : board.types.find((t) => t !== 'epic');
  const suggestions = [
    ...new Set([...lanes, ...phases.map((p) => p.department ?? '').filter(Boolean)]),
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !type || add.isPending) return;
    add.mutate(
      {
        project_slug: epic.project_slug,
        board_slug: epic.board_slug,
        title: trimmed,
        type,
        parent_key: epic.key,
        phase,
        ...(lane.trim() ? { department: lane.trim() } : {}),
      },
      { onSuccess: () => setTitle('') },
    );
  };

  return (
    <form
      onSubmit={submit}
      aria-label={`Add ticket to ${epic.key}`}
      className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-line p-2"
    >
      <div className="min-w-40 flex-[2]">
        <label htmlFor={ids.title} className="mb-1 block text-xs text-dim">
          Add ticket to this feature
        </label>
        <Input
          id={ids.title}
          autoComplete="off"
          placeholder="Ticket title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="min-w-28 flex-1">
        <label htmlFor={ids.phase} className="mb-1 block text-xs text-dim">
          Phase
        </label>
        <Select id={ids.phase} value={phase} onChange={(e) => setPhase(e.target.value)}>
          {phases.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-28 flex-1">
        <label htmlFor={ids.lane} className="mb-1 block text-xs text-dim">
          Team lane
        </label>
        <Input
          id={ids.lane}
          autoComplete="off"
          maxLength={40}
          list={ids.lanes}
          placeholder="Backend"
          value={lane}
          onChange={(e) => setLane(e.target.value)}
        />
        <datalist id={ids.lanes}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <Button type="submit" variant="primary" disabled={!title.trim() || !type || add.isPending}>
        Add ticket
      </Button>
      {add.isError && <ErrorAlert className="w-full">{errorMessage(add.error)}</ErrorAlert>}
    </form>
  );
}

/**
 * A feature on its pipeline, on the Epics screen: the stepper (every phase, the current one marked,
 * done of total per phase), the tickets under it grouped by phase and team lane, and a form that adds
 * a ticket to the feature with its phase and lane preselected.
 */
export function FeaturePipeline({
  epic,
  items,
  board,
}: {
  epic: Ticket;
  items: readonly Ticket[];
  board: Board;
}) {
  const pipeline = useQuery(epicPipelineQuery(epic.key));
  const data = pipeline.data;
  if (pipeline.isError)
    return <ErrorAlert className="mt-3">{errorMessage(pipeline.error)}</ErrorAlert>;
  if (!data?.in_use) return null;

  const names = data.phases.map((p) => p.name);
  const untagged = items.filter((c) => !c.phase || !names.includes(c.phase));
  return (
    <div className="mt-3 space-y-3">
      <PipelineStepper phases={data.phases} current={data.current} completed={data.completed} />
      {data.phases.map((phase) => {
        const tickets = items.filter((c) => c.phase === phase.name);
        if (tickets.length === 0) return null;
        const lanes = byLane(tickets);
        return (
          <section key={phase.name} aria-label={`${phase.name} tickets`}>
            <h4 className="m-0 mb-1 text-xs font-semibold text-dim">{phase.name}</h4>
            {lanes.map(([lane, laneTickets]) => (
              <div key={lane} className="mb-2">
                {(lane || lanes.length > 1) && (
                  <p className="m-0 text-xs font-semibold">{lane || 'No lane'}</p>
                )}
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {laneTickets.map((t) => (
                    <TicketRow key={t.key} ticket={t} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {untagged.length > 0 && (
        <section aria-label="Tickets not in a phase">
          <h4 className="m-0 mb-1 text-xs font-semibold text-dim">Not in a phase</h4>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {untagged.map((t) => (
              <TicketRow key={t.key} ticket={t} />
            ))}
          </ul>
        </section>
      )}
      <AddTicketForm
        epic={epic}
        board={board}
        phases={data.phases}
        current={data.current ?? names[0] ?? ''}
        lanes={[...new Set(items.map((c) => c.department).filter((d): d is string => !!d))]}
      />
    </div>
  );
}
