import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * A button that asks in place before it acts, like InlineDelete, for actions that are not a
 * delete (deactivate, reactivate, revoke). `name` is the thing acted on, so a screen reader
 * hears "Deactivate Sam Adeyemi", not just "Deactivate".
 */
export function InlineConfirm({
  action,
  name,
  confirmLabel,
  variant = 'secondary',
  pending,
  onConfirm,
}: {
  /** The button's text: "Deactivate". */
  action: string;
  name: string;
  /** The yes button: "Yes, deactivate". */
  confirmLabel: string;
  variant?: ButtonProps['variant'];
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size="sm" aria-label={`${action} ${name}`} onClick={() => setAsking(true)}>
        {action}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="text-[13px]">
        {action} {name}?
      </span>
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
