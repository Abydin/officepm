import { hueOf, initialsOf, personName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Initials on a colour derived from the name, or a dashed "?" when nobody is assigned. */
export function Avatar({
  who,
  size = 'md',
  decorative = false,
}: {
  who: string | null | undefined;
  size?: 'md' | 'lg';
  /** A plain coloured disc with no text, for beside a name that is already there. */
  decorative?: boolean;
}) {
  const semantics = (label: string) =>
    decorative
      ? { 'aria-hidden': true as const }
      : { role: 'img', 'aria-label': label, title: label };
  const box = cn(
    'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none',
    size === 'lg' ? 'size-[30px] text-[13px]' : 'size-6 text-[10px]',
  );
  if (!who) {
    return (
      <span
        {...semantics('Unassigned')}
        className={cn(box, 'border border-dashed border-line-strong text-dim')}
      >
        {decorative ? null : '?'}
      </span>
    );
  }
  const name = personName(who);
  return (
    <span
      {...semantics(name)}
      className={cn(box, 'text-white')}
      style={{ background: `hsl(${hueOf(name.toLowerCase())} 46% 40%)` }}
    >
      {decorative ? null : initialsOf(name)}
    </span>
  );
}
