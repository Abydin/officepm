import { isEpic, MAX_TITLE_LENGTH, type Ticket } from '@officepm/shared';
import { useId, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/avatar';
import { StatusPill } from '@/components/status-pill';
import { ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useCreateSubticket } from './api';
import { SectionTitle } from './commit-fields';
import { useTicketDrawer } from './use-ticket-drawer';

/**
 * The sub-tickets of a ticket: add one by typing a title and pressing Enter, open one by
 * clicking it. The box is not offered where the server would refuse (an epic, or a ticket
 * that is already a sub-ticket); a sentence says why instead. The rules stay in
 * shared/subtickets.ts, and any other refusal is still shown from the server's message.
 */
export function SubticketsSection({ ticket }: { ticket: Ticket }) {
  const create = useCreateSubticket(ticket.key);
  const { open } = useTicketDrawer();
  const [title, setTitle] = useState('');
  const titleId = useId();
  const inputId = useId();
  const items = ticket.subtickets ?? [];
  const progress = ticket.progress;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || create.isPending) return;
    // Clear the field only if it still holds what was sent, so text typed meanwhile is kept.
    create.mutate(
      { title: trimmed },
      { onSuccess: () => setTitle((current) => (current.trim() === trimmed ? '' : current)) },
    );
  };

  return (
    <section aria-labelledby={titleId}>
      <SectionTitle id={titleId}>
        Sub-tickets
        {progress && progress.total > 0 && (
          <span className="ml-2 font-mono tracking-normal normal-case">
            {progress.done}/{progress.total} done
          </span>
        )}
      </SectionTitle>
      {items.length > 0 && (
        <ul aria-label="Sub-tickets" className="m-0 mb-3 list-none space-y-1 p-0">
          {items.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => open(s.key)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-line bg-transparent px-2 py-1.5 text-left text-fg hover:bg-hover"
              >
                <span className="font-mono text-xs text-dim">{s.key}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="text-xs">
                  <StatusPill status={s.status} />
                </span>
                <Avatar who={s.assignee_name} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {ticket.subticket_of ? (
        <p className="m-0 text-dim">
          This is a sub-ticket of{' '}
          <button
            type="button"
            onClick={() => open(ticket.subticket_of!)}
            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-accent underline"
          >
            {ticket.subticket_of}
          </button>
          . Sub-tickets can&apos;t have their own.
        </p>
      ) : isEpic(ticket) ? (
        <p className="m-0 text-dim">
          Epics hold tickets. Create a ticket and set this epic as its Epic.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor={inputId} className="sr-only">
            New sub-ticket title
          </label>
          <Input
            id={inputId}
            placeholder="Add a sub-ticket, press Enter"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
          />
        </form>
      )}
      {create.isError && <ErrorAlert className="mt-2">{errorMessage(create.error)}</ErrorAlert>}
    </section>
  );
}
