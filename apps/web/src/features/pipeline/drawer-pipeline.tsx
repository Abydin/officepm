import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Board, Ticket } from '@officepm/shared';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { HandoffDialog } from '@/features/handoffs/handoff-dialog';
import { CommitInput, Field, frameless, SectionTitle } from '@/features/tickets/commit-fields';
import { ticketQuery } from '@/features/tickets/api';
import { errorMessage } from '@/lib/api';
import { epicPipelineQuery, projectPipelineQuery, useStartPipeline } from './api';
import { PipelineStepper } from './pipeline-stepper';

export const isEpic = (ticket: Pick<Ticket, 'level' | 'type'>) =>
  ticket.level === 'epic' || ticket.type === 'epic';

/**
 * An epic's pipeline in its drawer: the stepper and a button that opens the handoff dialog (which
 * moves a feature between phases). Every move is also a handoff comment, so the history is in the
 * ticket's Activity and is not repeated here. An epic that has not started a pipeline shows one
 * line and a button to start it.
 */
export function FeaturePipelineSection({ ticket, board }: { ticket: Ticket; board: Board }) {
  const titleId = useId();
  const pipeline = useQuery(epicPipelineQuery(ticket.key));
  const start = useStartPipeline(ticket.key);
  const [moving, setMoving] = useState(false);
  const data = pipeline.data;

  return (
    <section aria-labelledby={titleId}>
      <SectionTitle id={titleId}>Pipeline</SectionTitle>
      {pipeline.isError && <ErrorAlert>{errorMessage(pipeline.error)}</ErrorAlert>}
      {pipeline.isPending && <Skeleton className="h-16" />}
      {data && !data.in_use && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-dim">This feature is not on a pipeline.</p>
          <Button size="sm" disabled={start.isPending} onClick={() => start.mutate()}>
            Start pipeline
          </Button>
          {start.isError && <ErrorAlert>{errorMessage(start.error)}</ErrorAlert>}
        </div>
      )}
      {data?.in_use && (
        <div className="space-y-3">
          <PipelineStepper phases={data.phases} current={data.current} completed={data.completed} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="primary" onClick={() => setMoving(true)}>
              Move feature
            </Button>
            {data.completed && <span className="text-ok">Complete</span>}
          </div>
        </div>
      )}
      {moving && (
        <HandoffDialog
          request={{ ticket, board }}
          onClose={() => setMoving(false)}
          onDone={() => setMoving(false)}
        />
      )}
    </section>
  );
}

/**
 * Whether the phase and team lane apply to a ticket: its feature is on a pipeline, or it already
 * carries a tag. A project that never uses pipelines sees nothing.
 */
export function usePipelineTagsApply(ticket: Ticket): boolean {
  const parent = useQuery({
    ...ticketQuery(ticket.parent_key ?? ''),
    enabled: !!ticket.parent_key,
  });
  const tagged = Boolean(ticket.phase || ticket.department);
  return !isEpic(ticket) && Boolean(ticket.parent_key) && (tagged || Boolean(parent.data?.phase));
}

interface TagFieldProps {
  ticket: Ticket;
  save: (patch: { phase?: string | null; department?: string | null }) => void;
  /** A key that changes when the saved value does, or when a save is refused, so the field is rebuilt. */
  keyed: (name: string, value: string) => string;
}

/** The ticket's own pipeline phase, as a sidebar row. */
export function PhaseField({ ticket, save }: Omit<TagFieldProps, 'keyed'>) {
  const phases = useQuery(projectPipelineQuery(ticket.project_slug));
  const names = phases.data?.phases.map((p) => p.name) ?? [];
  return (
    <Field row prop="phase" label="Phase">
      {(id) => (
        <Select
          id={id}
          className={frameless}
          value={ticket.phase ?? ''}
          onChange={(e) => save({ phase: e.target.value || null })}
        >
          <option value="">None</option>
          {ticket.phase && !names.includes(ticket.phase) && (
            <option value={ticket.phase}>{ticket.phase}</option>
          )}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The team lane (department) the ticket is tagged with, as a sidebar row. */
export function TeamLaneField({ ticket, save, keyed }: TagFieldProps) {
  return (
    <Field row prop="team_lane" label="Team lane">
      {(id) => (
        <CommitInput
          key={keyed('lane', ticket.department ?? '')}
          id={id}
          className={frameless}
          maxLength={40}
          placeholder="Backend, Frontend..."
          value={ticket.department ?? ''}
          onCommit={(value) => save({ department: value.trim() || null })}
        />
      )}
    </Field>
  );
}
