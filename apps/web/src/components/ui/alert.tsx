import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** v1's `.error-banner`. role="alert" so a screen reader announces it when it appears. */
export function ErrorAlert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-err bg-err-soft px-3 py-2 text-[13px] text-err',
        className,
      )}
      {...props}
    />
  );
}

/** v1's `.empty-state`: a dashed box that says what is missing and what to do. */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-dim',
        className,
      )}
    >
      <strong className="mb-1 block text-fg">{title}</strong>
      {children}
    </div>
  );
}
