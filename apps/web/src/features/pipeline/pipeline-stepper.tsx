import { Check } from 'lucide-react';
import type { EpicPhase } from '@officepm/shared';
import { cn } from '@/lib/utils';

/**
 * Every phase of a feature's pipeline in order. The current one is marked with aria-current and
 * the word "current", the ones behind it are ticked, and each shows how many of the tickets tagged
 * with that phase are done. State is never carried by colour alone.
 */
export function PipelineStepper({
  phases,
  current,
  completed,
}: {
  phases: readonly EpicPhase[];
  current: string | null;
  completed: boolean;
}) {
  const at = phases.findIndex((p) => p.name === current);
  return (
    <ol
      aria-label="Pipeline"
      className="m-0 flex list-none flex-wrap gap-2 p-0"
      data-testid="pipeline-stepper"
    >
      {phases.map((phase, i) => {
        const isCurrent = i === at && !completed;
        const passed = completed || i < at;
        return (
          <li
            key={phase.name}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'min-w-24 flex-1 rounded-md border px-2.5 py-1.5',
              isCurrent ? 'border-accent bg-accent-soft' : 'border-line',
            )}
          >
            <span className="flex items-center gap-1.5 font-semibold">
              {passed && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 break-words">{phase.name}</span>
            </span>
            <span className="block text-xs text-dim">
              {isCurrent && <span className="font-semibold text-fg">Current</span>}
              {isCurrent && phase.total > 0 && ' · '}
              {phase.total > 0 && `${phase.done} of ${phase.total} done`}
              {passed && phase.total === 0 && 'Done'}
              {!isCurrent && !passed && phase.total === 0 && '\u00A0'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
