import { hueOf, initialsOf, personName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Initials on a colour derived from the name, or a dashed "?" when nobody is assigned. */
export function Avatar({
  who,
  size = 'md',
}: {
  who: string | null | undefined;
  size?: 'md' | 'lg';
}) {
  const box = cn(
    'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none',
    size === 'lg' ? 'size-[30px] text-[13px]' : 'size-6 text-[10px]',
  );
  if (!who) {
    return (
      <span
        role="img"
        aria-label="Unassigned"
        title="Unassigned"
        className={cn(box, 'border border-dashed border-line-strong text-dim')}
      >
        ?
      </span>
    );
  }
  const name = personName(who);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(box, 'text-white')}
      style={{ background: `hsl(${hueOf(name.toLowerCase())} 46% 40%)` }}
    >
      {initialsOf(name)}
    </span>
  );
}
