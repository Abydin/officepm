import type { DashboardSprint } from '@officepm/shared';
import { cn } from '@/lib/utils';

export function VelocityBars({ velocity }: { velocity: DashboardSprint['velocity'] }) {
  const max = Math.max(1, ...velocity.sprints.map((s) => s.completed));
  const unit = velocity.uses_points ? 'pts' : 'tickets';
  return (
    <>
      <div
        role="img"
        aria-label={`Velocity per sprint in ${unit}`}
        className="flex items-end justify-around gap-3 pt-1"
      >
        {velocity.sprints.map((s) => {
          const active = s.status === 'active';
          return (
            <div
              key={s.name}
              title={`${s.name}: ${s.completed} ${unit}${active ? ' so far' : ''}`}
              className="flex max-w-30 min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="flex h-24 w-full flex-col items-center justify-end gap-1">
                <span className="text-xs font-semibold">{s.completed}</span>
                <div
                  className={cn(
                    'w-full max-w-12 rounded-t-sm',
                    active
                      ? 'border border-b-0 border-accent bg-[repeating-linear-gradient(135deg,var(--accent)_0_5px,var(--accent-soft)_5px_10px)]'
                      : 'bg-accent',
                  )}
                  style={{ height: Math.max(3, Math.round((s.completed / max) * 72)) }}
                />
              </div>
              <span className="w-full truncate border-t border-line pt-1 text-center text-[11px] text-dim">
                {s.name}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 mb-0 text-xs text-dim">
        {velocity.average === null
          ? 'No finished sprints yet.'
          : `Average ${velocity.average} ${unit} per finished sprint. Striped bar is the sprint in progress.`}
      </p>
    </>
  );
}
