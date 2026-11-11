import { CalendarDays } from 'lucide-react';
import { dayDiff, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** "Today", "Tomorrow" or a short date. Red when late, amber within two days, unless the ticket is done. */
export function DueChip({ date, done = false }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const d = dayDiff(date);
  const late = !done && d < 0;
  const soon = !done && d >= 0 && d <= 2;
  const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : shortDate(date);
  return (
    <span
      title={`Due ${date}`}
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        late ? 'text-err' : soon ? 'text-warn' : 'text-dim',
      )}
    >
      <CalendarDays className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Due </span>
      {label}
      {late && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}
