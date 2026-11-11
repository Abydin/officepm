import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        'min-h-8 w-full rounded-md border border-line-strong bg-field px-2.5 py-1.5 text-fg transition-colors placeholder:text-dim/80 hover:not-disabled:border-dim focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
