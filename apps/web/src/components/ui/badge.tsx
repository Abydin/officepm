import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** v1's `.flow-badge`: a small uppercase pill for a board's flow, or a flag such as GitHub. */
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] tracking-wide text-dim uppercase',
        className,
      )}
      {...props}
    />
  );
}
