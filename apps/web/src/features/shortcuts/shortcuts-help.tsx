import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ROWS: Array<[keys: string, does: string]> = [
  ['Ctrl/Cmd + K, or /', 'Command palette'],
  ['C', 'Create a ticket (focuses the title box on a board)'],
  ['G then B', 'Go to the board'],
  ['G then S', 'Go to Backlog, Cycles or Phases'],
  ['G then R', 'Go to Retros'],
  ['J / K', 'Next / previous ticket on the board'],
  ['Enter', 'Open the highlighted ticket'],
  ['E', 'Open the highlighted ticket with the title selected'],
  ['A', 'Assign the highlighted or open ticket to me'],
  ['Drag a card', 'Move it to another column'],
  ['Space, then Left / Right, then Space', 'Move a focused card with the keyboard'],
  ['Alt + Left / Right', 'Move a focused card one column'],
  ['?', 'Show this help'],
  ['Esc', 'Close the drawer or dialog'],
];

export function ShortcutsHelp({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[10vh] left-1/2 z-50 max-h-[80vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 animate-pop overflow-y-auto rounded-xl border border-line-strong bg-raised p-4 shadow-pop focus:outline-none"
        >
          <div className="mb-3 flex items-center">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold">
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {ROWS.map(([keys, does]) => (
              <div key={keys} className="contents">
                <dt>
                  <kbd className="rounded border border-line-strong bg-field px-1.5 py-0.5 font-mono text-xs">
                    {keys}
                  </kbd>
                </dt>
                <dd className="m-0 text-dim">{does}</dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
