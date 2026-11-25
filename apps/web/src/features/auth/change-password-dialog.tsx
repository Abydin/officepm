import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PasswordChangeForm } from './password-form';

/** A person changing their own password. Their other devices are signed out; this one stays. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade bg-black/50" />
        <Dialog.Content
          aria-describedby="change-password-note"
          className="fixed top-[15vh] left-1/2 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 animate-pop rounded-xl border border-line-strong bg-raised p-4 shadow-pop focus:outline-none"
        >
          <div className="mb-2 flex items-center">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold">
              Change password
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <p id="change-password-note" className="mt-0 mb-3 text-dim">
            {done
              ? 'Your password is changed. You were signed out everywhere else.'
              : 'You will be signed out on every other device.'}
          </p>
          {done ? (
            <div className="flex justify-end">
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          ) : (
            <PasswordChangeForm
              autoFocus={false}
              onDone={() => setDone(true)}
              actions={<Button onClick={onClose}>Cancel</Button>}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
