import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  options: readonly ComboOption[];
  /** The selected option's value, if any; shows a check beside it. */
  value?: string | null;
  onSelect: (value: string) => void;
  /** What the trigger button shows. */
  children: ReactNode;
  /** Accessible name of the trigger (include the current value). */
  triggerLabel: string;
  searchLabel: string;
  /** Lets someone type a value that is not in the list: returns an option for the typed text, or null if it is not acceptable. */
  parseCustom?: (text: string) => ComboOption | null;
  /** Offered above the list, for "no one" and similar. */
  clearOption?: { label: string; onSelect: () => void };
  disabled?: boolean;
  triggerClassName?: string;
  id?: string;
}

const item =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg data-[selected=true]:bg-hover';

/**
 * A searchable picker: a button that opens a filtered list. Built on cmdk inside
 * a Radix popover, so it has a focus trap, Escape and arrow-key navigation. Used
 * for people, labels and parent tickets, where a plain select would be too long
 * or free text would let a typo through.
 */
export function Combobox({
  options,
  value,
  onSelect,
  children,
  triggerLabel,
  searchLabel,
  parseCustom,
  clearOption,
  disabled,
  triggerClassName,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const custom = parseCustom?.(search) ?? null;
  const showCustom = custom !== null && !options.some((o) => o.value === custom.value);

  const choose = (action: () => void) => {
    action();
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <Popover.Trigger
        id={id}
        disabled={disabled}
        aria-label={triggerLabel}
        className={cn(
          'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 py-1 text-left text-fg hover:not-disabled:border-dim focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none disabled:opacity-60',
          triggerClassName,
        )}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[60] w-[min(300px,calc(100vw-32px))] animate-pop rounded-lg border border-line-strong bg-raised p-1.5 shadow-pop"
        >
          <Command label={searchLabel}>
            <Command.Input
              aria-label={searchLabel}
              value={search}
              onValueChange={setSearch}
              placeholder="Search"
              className="mb-1 min-h-8 w-full rounded-md border border-line-strong bg-field px-2.5 py-1 text-fg placeholder:text-dim/80 focus-visible:border-ring focus-visible:outline-none"
            />
            <Command.List className="max-h-60 overflow-y-auto">
              <Command.Empty className="px-2 py-3 text-center text-[13px] text-dim">
                Nothing matches.
              </Command.Empty>
              {clearOption && (
                <Command.Item
                  value="__clear"
                  keywords={[clearOption.label]}
                  onSelect={() => choose(clearOption.onSelect)}
                  className={cn(item, 'text-dim')}
                >
                  {clearOption.label}
                </Command.Item>
              )}
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.value}
                  keywords={[o.label, o.hint ?? '']}
                  onSelect={() => choose(() => onSelect(o.value))}
                  className={item}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="truncate text-xs text-dim">{o.hint}</span>}
                  {o.value === value && (
                    <Check className="size-4 text-accent" aria-label="Selected" />
                  )}
                </Command.Item>
              ))}
              {showCustom && custom && (
                <Command.Item
                  value={`__custom ${custom.value}`}
                  forceMount
                  onSelect={() => choose(() => onSelect(custom.value))}
                  className={item}
                >
                  Use {custom.label}
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
