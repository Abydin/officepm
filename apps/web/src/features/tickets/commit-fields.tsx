import { useId, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** A label above a control. The render prop receives the id to put on the control. */
export function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', wide && 'col-span-2')}>
      <label htmlFor={id} className="text-xs text-dim">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="mt-0 mb-2 text-[11px] font-semibold tracking-[0.07em] text-dim uppercase"
    >
      {children}
    </h3>
  );
}

/**
 * A text-like input that saves when you leave it or press Enter. It is
 * uncontrolled: the parent re-keys it when the saved value changes, which also
 * puts the old text back if a save is refused.
 */
export function CommitInput({
  value,
  onCommit,
  ref,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
  ref?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onBlur'>) {
  return (
    <Input
      ref={ref}
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      {...props}
    />
  );
}

const textarea =
  'w-full rounded-md border border-line-strong bg-field px-2.5 py-1.5 text-fg placeholder:text-dim/80 hover:border-dim focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none';

/** Multi-line version of CommitInput: saves on blur. */
export function CommitTextarea({
  value,
  onCommit,
  className,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onBlur'>) {
  return (
    <textarea
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      className={cn(textarea, className)}
      {...props}
    />
  );
}

export const textareaClass = textarea;
