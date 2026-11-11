import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-sm leading-tight font-medium whitespace-nowrap no-underline transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
  {
    variants: {
      variant: {
        primary:
          'border-accent bg-accent font-semibold text-accent-ink hover:brightness-110 disabled:hover:brightness-100',
        secondary: 'border-line-strong bg-raised text-fg hover:bg-hover',
        ghost: 'border-transparent bg-transparent text-dim hover:bg-hover hover:text-fg',
        danger: 'border-err bg-transparent text-err hover:bg-err-soft',
      },
      size: {
        default: 'px-3 py-1',
        sm: 'min-h-[26px] px-2 py-0.5 text-xs',
        icon: 'w-8 px-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (a link, say) with the button's styling. */
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      // A bare <button> inside a form submits it; make that a choice, not an accident.
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}
