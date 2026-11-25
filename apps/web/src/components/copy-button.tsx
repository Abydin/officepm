import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';

/**
 * Copies `text` and says so. `name` is what is being copied, so the button reads "Copy invite
 * link" to a screen reader, not just "Copy". If the browser refuses, the message says to copy by hand.
 */
export function CopyButton({ text, name }: { text: string; name: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => setState((await copyText(text)) ? 'copied' : 'failed');
  return (
    <>
      <Button size="sm" aria-label={`Copy ${name}`} onClick={() => void copy()}>
        {state === 'copied' ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      <span aria-live="polite" className="text-xs text-dim empty:hidden">
        {state === 'failed' ? 'Could not copy, select it and copy by hand.' : ''}
      </span>
    </>
  );
}
