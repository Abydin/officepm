import * as Dialog from '@radix-ui/react-dialog';
import {
  PRIORITIES,
  flowSupports,
  type Board,
  type Ticket,
  type TicketPatch,
} from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Combobox } from '@/components/ui/combobox';
import { DrawerContent } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarkHandoffsRead, unreadHandoffsQuery } from '@/features/handoffs/api';
import { HandoffDialog } from '@/features/handoffs/handoff-dialog';
import { boardQuery, boardTicketsQuery } from '@/features/projects/api';
import { boardLabels } from '@/features/projects/board-filter';
import { errorMessage } from '@/lib/api';
import { personName } from '@/lib/format';
import { sprintsQuery, ticketQuery, useDeleteTicket, useUpdateTicket } from './api';
import { CommitInput, CommitTextarea, Field, SectionTitle } from './commit-fields';
import {
  ActivitySection,
  DodSection,
  FilesSection,
  GithubSection,
  LinksSection,
} from './drawer-sections';
import {
  FeaturePipelineSection,
  isEpic,
  PipelineTagsSection,
} from '@/features/pipeline/drawer-pipeline';
import { PeopleSection } from './people-section';
import { SubticketsSection } from './subtickets-section';
import { parseEmail, usePeople } from './people';
import { useTicketDrawer } from './use-ticket-drawer';

const APPETITES = ['1 week', '2 weeks', '3 weeks', '6 weeks'];
const LEVELS = ['epic', 'story', 'task', 'bug'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mounted once in the app shell. Renders nothing unless the URL has ?t=KEY. */
export function TicketDrawerHost() {
  const { openKey } = useTicketDrawer();
  return openKey ? <TicketDrawer key={openKey} ticketKey={openKey} /> : null;
}

function TicketDrawer({ ticketKey }: { ticketKey: string }) {
  const { close, focusTitle } = useTicketDrawer();
  const content = useRef<HTMLDivElement>(null);
  const ticket = useQuery(ticketQuery(ticketKey));
  const t = ticket.data;
  const board = useQuery({
    ...boardQuery(t?.project_slug ?? '', t?.board_slug ?? ''),
    enabled: Boolean(t),
  });

  // Opening a ticket is reading what was handed over on it.
  const unread = useQuery(unreadHandoffsQuery);
  const { mutate: markHandoffsRead } = useMarkHandoffsRead();
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const fresh = (unread.data ?? []).filter(
      (n) => n.ticket_key === ticketKey && !requested.current.has(n.id),
    );
    if (fresh.length === 0) return;
    for (const n of fresh) requested.current.add(n.id);
    markHandoffsRead(ticketKey);
  }, [unread.data, markHandoffsRead, ticketKey]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <DrawerContent
        ref={content}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Start on the dialog itself so a screen reader announces its title first;
          // the E shortcut moves the caret into the title once the ticket has loaded.
          event.preventDefault();
          content.current?.focus();
        }}
      >
        <Dialog.Title className="sr-only">Ticket {ticketKey}</Dialog.Title>
        {ticket.isError ? (
          <div className="p-4">
            <ErrorAlert className="mb-3">{errorMessage(ticket.error)}</ErrorAlert>
            <Dialog.Close asChild>
              <Button>Close</Button>
            </Dialog.Close>
          </div>
        ) : !t || !board.data ? (
          <div role="status" aria-label="Loading ticket" className="space-y-3 p-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-9" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <DrawerBody ticket={t} board={board.data} focusTitle={focusTitle} />
        )}
      </DrawerContent>
    </Dialog.Root>
  );
}

function DrawerBody({
  ticket,
  board,
  focusTitle,
}: {
  ticket: Ticket;
  board: Board;
  focusTitle: boolean;
}) {
  const { close, open } = useTicketDrawer();
  const update = useUpdateTicket(ticket.key);
  const remove = useDeleteTicket();
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // A status picked here is not applied: it opens the handoff dialog, and the select stays put until that confirms.
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const titleFocused = useRef(false);

  const boardTickets = useQuery(boardTicketsQuery(ticket.project_slug, ticket.board_slug));
  const people = usePeople(boardTickets.data);
  const timeboxed =
    flowSupports(board.flow, 'sprints') ||
    flowSupports(board.flow, 'cycles') ||
    flowSupports(board.flow, 'phases');
  const sprints = useQuery({
    ...sprintsQuery(ticket.project_slug, ticket.board_slug),
    enabled: timeboxed,
  });
  const parents = useMemo(
    () =>
      (boardTickets.data ?? [])
        .filter((x) => x.key !== ticket.key)
        .sort((a, b) => Number(b.level === 'epic') - Number(a.level === 'epic'))
        .map((x) => ({ value: x.key, label: x.key, hint: x.title })),
    [boardTickets.data, ticket.key],
  );

  // Saving puts the old value back, on screen and in the cache, if the server refuses.
  const save = (patch: TicketPatch) =>
    update.mutate(patch, { onError: () => setVersion((v) => v + 1) });
  const k = (name: string, value: string) => `${version}:${name}:${value}`;

  // The directory's real name when it is known, else the readable form of the email.
  const nameOf = (email: string) =>
    people.find((p) => p.value === email)?.label ?? personName(email);
  const person = (email: string | null, empty: string) => (
    <>
      <Avatar who={email} decorative />
      <span className="min-w-0 flex-1 truncate">{email ? nameOf(email) : empty}</span>
    </>
  );

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="font-mono font-bold">{ticket.key}</span>
        {ticket.level && ticket.level !== ticket.type && <Badge>{ticket.level}</Badge>}
        <Badge>{ticket.type}</Badge>
        {ticket.subticket_of && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`sub of ${ticket.subticket_of}, open parent`}
            onClick={() => open(ticket.subticket_of!)}
          >
            sub of <span className="font-mono">{ticket.subticket_of}</span>
          </Button>
        )}
        <span role="status" className="text-xs text-dim">
          {update.isPending ? 'Saving...' : ''}
        </span>
        <span className="flex-1" />
        {confirming ? (
          <>
            <span className="text-[13px]">Delete {ticket.key}?</span>
            <Button
              variant="danger"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate(ticket.key, { onSuccess: close })}
            >
              Yes, delete
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        )}
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close ticket" title="Close (Esc)">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {update.isError && <ErrorAlert>{errorMessage(update.error)}</ErrorAlert>}
        {remove.isError && <ErrorAlert>{errorMessage(remove.error)}</ErrorAlert>}

        <section>
          <Field label="Title">
            {(id) => (
              <CommitInput
                key={k('title', ticket.title)}
                id={id}
                value={ticket.title}
                className="text-[15px] font-semibold"
                ref={(el) => {
                  if (el && focusTitle && !titleFocused.current) {
                    titleFocused.current = true;
                    el.focus();
                    el.select();
                  }
                }}
                onCommit={(value) => {
                  if (value.trim()) save({ title: value.trim() });
                  else setVersion((v) => v + 1);
                }}
              />
            )}
          </Field>
        </section>

        <section aria-labelledby="fields-title">
          <SectionTitle id="fields-title">Fields</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              {(id) => (
                <Select id={id} value={ticket.status} onChange={(e) => setMoveTo(e.target.value)}>
                  {board.statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Priority">
              {(id) => (
                <Select
                  id={id}
                  value={ticket.priority ?? ''}
                  onChange={(e) =>
                    save({ priority: PRIORITIES.find((p) => p === e.target.value) ?? null })
                  }
                >
                  <option value="">None</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {cap(p)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Due date">
              {(id) => (
                <CommitInput
                  key={k('due', ticket.due_date ?? '')}
                  id={id}
                  type="date"
                  value={ticket.due_date ?? ''}
                  onCommit={(value) => save({ due_date: value || null })}
                />
              )}
            </Field>
            <Field label="Assignee">
              {(id) => (
                <Combobox
                  id={id}
                  options={people}
                  value={ticket.assignee}
                  triggerLabel={`Assignee: ${ticket.assignee ? nameOf(ticket.assignee) : 'Unassigned'}`}
                  searchLabel="Find a person or type an email"
                  parseCustom={parseEmail}
                  clearOption={{ label: 'Unassigned', onSelect: () => save({ assignee: null }) }}
                  onSelect={(assignee) => save({ assignee })}
                >
                  {person(ticket.assignee, 'Unassigned')}
                </Combobox>
              )}
            </Field>
            <Field label="QA owner">
              {(id) => (
                <Combobox
                  id={id}
                  options={people}
                  value={ticket.qa_owner}
                  triggerLabel={`QA owner: ${ticket.qa_owner ? nameOf(ticket.qa_owner) : 'None'}`}
                  searchLabel="Find a person or type an email"
                  parseCustom={parseEmail}
                  clearOption={{ label: 'No QA owner', onSelect: () => save({ qa_owner: null }) }}
                  onSelect={(qa_owner) => save({ qa_owner })}
                >
                  {person(ticket.qa_owner, 'None')}
                </Combobox>
              )}
            </Field>
            {timeboxed && (
              <Field
                label={
                  board.flow === 'shapeup'
                    ? 'Cycle'
                    : board.flow === 'waterfall'
                      ? 'Phase'
                      : 'Sprint'
                }
              >
                {(id) => (
                  <Select
                    id={id}
                    value={ticket.sprint_id ?? ''}
                    onChange={(e) => save({ sprint_id: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {ticket.sprint_id && !sprints.data?.some((s) => s.id === ticket.sprint_id) && (
                      <option value={ticket.sprint_id}>Unknown</option>
                    )}
                    {sprints.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.status}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {board.points && (
              <Field label="Points">
                {(id) => (
                  <CommitInput
                    key={k('points', String(ticket.points ?? ''))}
                    id={id}
                    type="number"
                    min={0}
                    step={1}
                    value={ticket.points == null ? '' : String(ticket.points)}
                    onCommit={(value) => {
                      const n = Number(value);
                      if (value === '') save({ points: null });
                      else if (Number.isInteger(n) && n >= 0) save({ points: n });
                      else setVersion((v) => v + 1);
                    }}
                  />
                )}
              </Field>
            )}
            {board.flow === 'shapeup' && (
              <Field label="Appetite">
                {(id) => (
                  <Select
                    id={id}
                    value={ticket.appetite ?? ''}
                    onChange={(e) => save({ appetite: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {ticket.appetite && !APPETITES.includes(ticket.appetite) && (
                      <option value={ticket.appetite}>{ticket.appetite}</option>
                    )}
                    {APPETITES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {board.agile && (
              <Field label="Level">
                {(id) => (
                  <Select
                    id={id}
                    value={ticket.level ?? 'task'}
                    onChange={(e) => save({ level: e.target.value })}
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Parent ticket">
              {(id) => (
                <Combobox
                  id={id}
                  options={parents}
                  value={ticket.parent_key}
                  triggerLabel={`Parent ticket: ${ticket.parent_key ?? 'None'}`}
                  searchLabel="Find a ticket"
                  clearOption={{ label: 'No parent', onSelect: () => save({ parent_key: null }) }}
                  onSelect={(parent_key) => save({ parent_key })}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {ticket.parent_key ?? <span className="font-sans text-dim">None</span>}
                  </span>
                </Combobox>
              )}
            </Field>
            <LabelsField
              labels={ticket.labels}
              suggestions={boardLabels(boardTickets.data ?? [])}
              onChange={(labels) => save({ labels })}
            />
          </div>
        </section>

        {isEpic(ticket) && <FeaturePipelineSection ticket={ticket} board={board} />}
        {!isEpic(ticket) && <PipelineTagsSection ticket={ticket} />}

        <SubticketsSection ticket={ticket} />

        <PeopleSection ticket={ticket} />

        {board.agile && (
          <section aria-labelledby="blockers-title">
            <SectionTitle id="blockers-title">Blockers</SectionTitle>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={ticket.blocked}
                onChange={(e) => save({ blocked: e.target.checked })}
                className="size-4 accent-[var(--accent)]"
              />
              Blocked
            </label>
            {ticket.blocked && (
              <div className="mt-2">
                <Field label="Reason">
                  {(id) => (
                    <CommitInput
                      key={k('reason', ticket.blocker_reason ?? '')}
                      id={id}
                      value={ticket.blocker_reason ?? ''}
                      onCommit={(value) => save({ blocker_reason: value.trim() || null })}
                    />
                  )}
                </Field>
              </div>
            )}
          </section>
        )}

        {board.agile && <DodSection ticketKey={ticket.key} />}

        <section>
          <Field label="Description">
            {(id) => (
              <CommitTextarea
                key={k('description', ticket.description ?? '')}
                id={id}
                rows={4}
                value={ticket.description ?? ''}
                onCommit={(value) => save({ description: value.trim() || null })}
              />
            )}
          </Field>
        </section>

        {ticket.level === 'story' && (
          <section>
            <Field label="Acceptance criteria (one per line)">
              {(id) => (
                <CommitTextarea
                  key={k('criteria', ticket.acceptance_criteria.join('\n'))}
                  id={id}
                  rows={3}
                  value={ticket.acceptance_criteria.join('\n')}
                  onCommit={(value) =>
                    save({
                      acceptance_criteria: value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
          </section>
        )}

        {board.has_github && <GithubSection ticketKey={ticket.key} />}
        <LinksSection ticketKey={ticket.key} />
        <FilesSection ticketKey={ticket.key} />
        <ActivitySection ticket={ticket} />
      </div>
      {moveTo !== null && (
        <HandoffDialog
          key={moveTo}
          request={{ ticket, board, target: moveTo }}
          onClose={() => setMoveTo(null)}
          onDone={() => setMoveTo(null)}
        />
      )}
    </>
  );
}

/** Label chips with a picker for adding: existing labels on the board, or a new one (up to 8, 24 characters). */
function LabelsField({
  labels,
  suggestions,
  onChange,
}: {
  labels: string[];
  suggestions: string[];
  onChange: (labels: string[]) => void;
}) {
  const full = labels.length >= 8;
  return (
    <div className="col-span-2 flex flex-col gap-1">
      <span id="labels-label" className="text-xs text-dim">
        Labels
      </span>
      <div
        role="group"
        aria-labelledby="labels-label"
        className="flex flex-wrap items-center gap-1.5"
      >
        {labels.map((l) => (
          <span
            key={l}
            className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 text-xs"
          >
            {l}
            <button
              type="button"
              aria-label={`Remove label ${l}`}
              className="inline-flex size-4 cursor-pointer items-center justify-center rounded text-dim hover:text-fg"
              onClick={() => onChange(labels.filter((x) => x !== l))}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {!full && (
          <Combobox
            triggerClassName="w-auto min-h-6 px-2 py-0.5 text-xs text-dim"
            triggerLabel="Add label"
            searchLabel="Find a label or type a new one"
            options={suggestions
              .filter((s) => !labels.includes(s))
              .map((s) => ({ value: s, label: s }))}
            parseCustom={(text) => {
              const v = text.trim();
              return v && v.length <= 24 ? { value: v, label: `"${v}"` } : null;
            }}
            onSelect={(label) => onChange([...labels, label])}
          >
            <Plus className="size-3" aria-hidden="true" />
            Add label
          </Combobox>
        )}
        {full && <span className="text-xs text-dim">Eight labels is the most.</span>}
      </div>
    </div>
  );
}
