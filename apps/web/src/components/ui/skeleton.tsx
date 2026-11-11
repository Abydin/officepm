import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'min-h-3.5 animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--bg-hover)_25%,var(--border)_50%,var(--bg-hover)_75%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
