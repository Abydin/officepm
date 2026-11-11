import type { Priority } from '@officepm/shared';
import { cn } from '@/lib/utils';

const LEVEL: Record<Priority, number> = { low: 1, medium: 2, high: 3, urgent: 3 };
const COLOR: Record<Priority, string> = {
  low: 'bg-[var(--p-low)]',
  medium: 'bg-[var(--p-medium)]',
  high: 'bg-[var(--p-high)]',
  urgent: 'bg-[var(--p-urgent)]',
};

/** Three rising bars, lit to the priority level. */
export function PriorityMark({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  const lit = LEVEL[priority];
  const heights = ['h-[5px]', 'h-2', 'h-3'];
  return (
    <span
      role="img"
      aria-label={`Priority ${priority}`}
      title={`Priority: ${priority}`}
      className="inline-flex h-3 items-end gap-0.5"
    >
      {heights.map((h, i) => (
        <i
          key={h}
          className={cn(
            'block w-[3px] rounded-[1px]',
            h,
            i < lit ? COLOR[priority] : 'bg-line-strong',
          )}
        />
      ))}
    </span>
  );
}
