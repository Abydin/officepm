import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** v1's `.panel`: a raised surface with a hairline border. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-lg border border-line bg-raised p-4', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-2', className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('m-0 text-[15px] font-semibold', className)} {...props} />;
}
