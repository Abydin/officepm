import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
export const SheetClose = DialogPrimitive.Close;

/** A panel that slides in from the left, below the 52px top bar. Radix supplies the focus trap, Esc and aria-modal. */
export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-x-0 top-[52px] bottom-0 z-40 animate-fade bg-black/45" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-[52px] bottom-0 left-0 z-50 flex w-65 max-w-[85vw] animate-slide flex-col overflow-y-auto border-r border-line bg-raised shadow-pop focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A full-height panel from the right edge, over the whole page, for the ticket drawer. */
export function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade bg-black/45" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] animate-slide-right flex-col border-l border-line bg-raised shadow-pop focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
