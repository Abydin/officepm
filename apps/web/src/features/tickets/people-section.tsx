import { PARTICIPANT_ROLE_MAX, type Ticket } from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { peopleQuery } from '@/features/handoffs/api';
import { errorMessage } from '@/lib/api';
import { useAddParticipant, useRemoveParticipant } from './api';
import { Field } from './commit-fields';

/**
 * Everyone on a ticket besides the assignee, each with an optional short role, as a row of the
 * property sidebar. "Add person" opens a popover holding the form. Anyone signed in may add or
 * remove people (v1 has no per-ticket permissions). The list is names and departments only: the
 * server never sends an email here.
 */
export function PeopleSection({ ticket }: { ticket: Ticket }) {
  const people = useQuery(peopleQuery);
  const add = useAddParticipant(ticket.key);
  const remove = useRemoveParticipant(ticket.key);
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const titleId = useId();
  const participants = ticket.participants ?? [];

  const everyone = people.data ?? [];
  const departments = [
    ...new Set(everyone.map((p) => p.department).filter((d): d is string => !!d)),
  ].sort((a, b) => a.localeCompare(b));
  const options = everyone
    .filter((p) => !participants.some((x) => x.id === p.id))
    .filter((p) => !department || p.department === department)
    .map((p) => ({ value: String(p.id), label: p.name, hint: p.department ?? '' }));
  const chosen = everyone.find((p) => String(p.id) === picked);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    add.mutate(
      { user_id: chosen.id, role: role.trim() || null },
      {
        onSuccess: () => {
          setPicked(null);
          setRole('');
          setOpen(false);
        },
      },
    );
  };

  return (
    <div data-prop="people" role="group" aria-labelledby={titleId} className="flex flex-col gap-1">
      <span id={titleId} className="text-xs text-dim">
        People
      </span>
      {add.isError && <ErrorAlert>{errorMessage(add.error)}</ErrorAlert>}
      {remove.isError && <ErrorAlert>{errorMessage(remove.error)}</ErrorAlert>}
      {participants.length > 0 && (
        <ul aria-label="People on this ticket" className="m-0 list-none space-y-1.5 p-0">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Avatar who={p.name} decorative />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                {p.department && (
                  <span className="block truncate text-xs text-dim">{p.department}</span>
                )}
              </span>
              {p.role && (
                <span className="max-w-24 truncate rounded border border-line-strong px-1.5 text-xs">
                  {p.role}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${p.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(p.id)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button size="sm" variant="ghost" className="self-start">
            <Plus className="size-3.5" aria-hidden="true" />
            Add a person
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            role="group"
            aria-label="Add a person to this ticket"
            align="start"
            sideOffset={4}
            className="z-[60] w-[min(320px,calc(100vw-32px))] animate-pop rounded-lg border border-line-strong bg-raised p-3 shadow-pop"
          >
            <form onSubmit={submit} className="grid gap-3">
              <Field label="Department">
                {(id) => (
                  <Select
                    id={id}
                    value={department}
                    onChange={(e) => {
                      setDepartment(e.target.value);
                      setPicked(null);
                    }}
                  >
                    <option value="">Any department</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Person">
                {(id) => (
                  <Combobox
                    id={id}
                    options={options}
                    value={picked}
                    triggerLabel={`Person to add: ${chosen ? chosen.name : 'Choose a person'}`}
                    searchLabel="Find a person"
                    onSelect={setPicked}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {chosen ? chosen.name : <span className="text-dim">Choose a person</span>}
                    </span>
                  </Combobox>
                )}
              </Field>
              <Field label={`Role (optional, ${PARTICIPANT_ROLE_MAX} characters)`}>
                {(id) => (
                  <Input
                    id={id}
                    value={role}
                    maxLength={PARTICIPANT_ROLE_MAX}
                    placeholder="PM, Frontend, Backend"
                    onChange={(e) => setRole(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" disabled={!chosen || add.isPending}>
                Add person
              </Button>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
