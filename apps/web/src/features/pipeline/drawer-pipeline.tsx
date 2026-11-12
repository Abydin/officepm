import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Board, Ticket } from '@officepm/shared';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { HandoffDialog } from '@/features/handoffs/handoff-dialog';
import { CommitInput, Field, SectionTitle } from '@/features/tickets/commit-fields';
import { ticketQuery, useUpdateTicket } from '@/features/tickets/api';
import { errorMessage } from '@/lib/api';
import { epicPipelineQuery, projectPipelineQuery, useStartPipeline } from './api';
import { PhaseHistory } from './phase-history';
import { PipelineStepper } from './pipeline-stepper';

export const isEpic = (ticket: Pick<Ticket, 'level' | 'type'>) =>
  ticket.level === 'epic' || ticket.type === 'epic';

/**
 * An epic's pipeline in its drawer: the stepper, a button that opens the handoff dialog (which moves
 * a feature between phases) and the history of every move. An epic that has not started a pipeline
 * shows one line and a button to start it.
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
          <PhaseHistory moves={data.history} />
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
 * The phase and department a ticket under a feature is tagged with. It appears only when the ticket's
 * feature is on a pipeline or the ticket already carries a tag, so a project that never uses
 * pipelines sees nothing.
 */
export function PipelineTagsSection({ ticket }: { ticket: Ticket }) {
  const titleId = useId();
  const parent = useQuery({
    ...ticketQuery(ticket.parent_key ?? ''),
    enabled: !!ticket.parent_key,
  });
  const phases = useQuery(projectPipelineQuery(ticket.project_slug));
  const update = useUpdateTicket(ticket.key);
  const [version, setVersion] = useState(0);
  const save = (patch: { phase?: string | null; department?: string | null }) =>
    update.mutate(patch, { onError: () => setVersion((v) => v + 1) });

  const tagged = Boolean(ticket.phase || ticket.department);
  if (!ticket.parent_key || (!tagged && !parent.data?.phase)) return null;
  const names = phases.data?.phases.map((p) => p.name) ?? [];

  return (
    <section aria-labelledby={titleId}>
      <SectionTitle id={titleId}>Feature pipeline</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phase">
          {(id) => (
            <Select
              id={id}
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
        <Field label="Team lane">
          {(id) => (
            <CommitInput
              key={`${version}:${ticket.department ?? ''}`}
              id={id}
              maxLength={40}
              placeholder="Backend, Frontend..."
              value={ticket.department ?? ''}
              onCommit={(value) => save({ department: value.trim() || null })}
            />
          )}
        </Field>
      </div>
      {update.isError && <ErrorAlert className="mt-2">{errorMessage(update.error)}</ErrorAlert>}
    </section>
  );
}
