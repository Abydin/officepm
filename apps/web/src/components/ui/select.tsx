import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** A styled native select: the picker for short, fixed lists, with the platform's own keyboard and touch behaviour. */
export function Select({
  className,
  ref,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <select
      ref={ref}
      className={cn(
        'min-h-8 w-full cursor-pointer rounded-md border border-line-strong bg-field px-2 py-1 text-fg hover:not-disabled:border-dim focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
