import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A delete button that asks in place, as the ticket drawer does, instead of
 * opening a dialog or calling window.confirm. `name` is what is being deleted,
 * so a screen reader hears "Delete Ordering API reference", not just "Delete".
 */
export function InlineDelete({
  name,
  pending,
  onConfirm,
}: {
  name: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Delete ${name}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Delete
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[13px]">Delete {name}?</span>
      <Button variant="danger" size="sm" disabled={pending} onClick={onConfirm}>
        Yes, delete
      </Button>
      <Button size="sm" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </span>
  );
}
