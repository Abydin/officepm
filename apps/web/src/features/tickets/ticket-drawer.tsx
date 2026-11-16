import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import {
  MAX_TITLE_LENGTH,
  flowSupports,
  type Board,
  type Ticket,
  type TicketPatch,
} from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { Ellipsis, Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { DrawerContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarkHandoffsRead, unreadHandoffsQuery } from '@/features/handoffs/api';
import { HandoffDialog } from '@/features/handoffs/handoff-dialog';
import { boardQuery, boardTicketsQuery } from '@/features/projects/api';
import { boardLabels } from '@/features/projects/board-filter';
import { isTyping } from '@/features/shortcuts/is-typing';
import { errorMessage } from '@/lib/api';
import { personName } from '@/lib/format';
import { sprintsQuery, ticketQuery, useDeleteTicket, useUpdateTicket } from './api';
import { CommitInput, CommitTextarea, Field, frameless } from './commit-fields';
import { PropertySidebar } from './drawer-properties';
import { ActivitySection, AttachmentsSection, DodSection } from './drawer-sections';
import {
  FeaturePipelineSection,
  isEpic,
  usePipelineTagsApply,
} from '@/features/pipeline/drawer-pipeline';
import { SubticketsSection } from './subtickets-section';
import { usePeople } from './people';
import { propertyVisibility, type PropertyId } from './property-visibility';
import { useTicketDrawer } from './use-ticket-drawer';

/** Mounted once in the app shell. Renders nothing unless the URL has ?t=KEY. */
export function TicketDrawerHost() {
  const { openKey } = useTicketDrawer();
  return openKey ? <TicketDrawer key={openKey} ticketKey={openKey} /> : null;
}

function TicketDrawer({ ticketKey }: { ticketKey: string }) {
  const { close, focusTitle, full } = useTicketDrawer();
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
        full={full}
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
          <DrawerBody ticket={t} board={board.data} focusTitle={focusTitle} container={content} />
        )}
      </DrawerContent>
    </Dialog.Root>
  );
}

function DrawerBody({
  ticket,
  board,
  focusTitle,
  container,
}: {
  ticket: Ticket;
  board: Board;
  focusTitle: boolean;
  /** The dialog element: the drawer's keys are heard here, so they stop at the dialog's edge. */
  container: RefObject<HTMLDivElement | null>;
}) {
  const { close, open, full, setFull } = useTicketDrawer();
  const update = useUpdateTicket(ticket.key);
  const remove = useDeleteTicket();
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A status picked here is not applied: it opens the handoff dialog, and the select stays put until that confirms.
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<PropertyId>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const pipelineTagsApply = usePipelineTagsApply(ticket);
  const { shown, addable } = propertyVisibility({
    board,
    ticket,
    pipelineTags: pipelineTagsApply,
    revealed,
  });

  // Saving puts the old value back, on screen and in the cache, if the server refuses.
  const save = (patch: TicketPatch) =>
    update.mutate(patch, { onError: () => setVersion((v) => v + 1) });
  const k = (name: string, value: string) => `${version}:${name}:${value}`;

  // The directory's real name when it is known, else the readable form of the email.
  const nameOf = (email: string) =>
    people.find((p) => p.value === email)?.label ?? personName(email);

  // F, P and R, heard on the dialog itself and only while no field has the keys. Popovers and the
  // handoff dialog are portalled out of it, so their own typing and shortcuts never reach here.
  const hasAddable = addable.length > 0;
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        setFull(!full);
      } else if (key === 'p' && hasAddable) {
        e.preventDefault();
        setPickerOpen(true);
      } else if (key === 'r') {
        e.preventDefault();
        document.getElementById('new-comment')?.focus();
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [container, full, setFull, hasAddable]);

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="font-mono font-bold">{ticket.key}</span>
        {ticket.level && ticket.level !== ticket.type && <Badge>{ticket.level}</Badge>}
        <Badge>{ticket.type}</Badge>
        {ticket.parent_key && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`in ${ticket.parent_key}, open epic`}
            onClick={() => open(ticket.parent_key!)}
          >
            in <span className="font-mono">{ticket.parent_key}</span>
          </Button>
        )}
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
            <Button size="sm" autoFocus onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="max-sm:hidden"
              aria-label={full ? 'Back to side panel' : 'Open full page'}
              title={full ? 'Back to side panel (F)' : 'Open full page (F)'}
              onClick={() => setFull(!full)}
            >
              {full ? (
                <Minimize2 className="size-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="size-4" aria-hidden="true" />
              )}
            </Button>
            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Popover.Trigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <Ellipsis className="size-4" aria-hidden="true" />
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  role="group"
                  aria-label="Ticket actions"
                  align="end"
                  sideOffset={4}
                  // The menu's trigger is replaced by the confirmation, so focus goes there instead.
                  onCloseAutoFocus={(event) => confirming && event.preventDefault()}
                  className="z-[60] animate-pop rounded-lg border border-line-strong bg-raised p-1.5 shadow-pop"
                >
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirming(true);
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete ticket
                  </Button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </>
        )}
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close ticket" title="Close (Esc)">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={
            full ? 'mx-auto w-full max-w-6xl p-4 @min-[700px]:p-6' : 'p-4 @min-[700px]:p-5'
          }
        >
          {update.isError && <ErrorAlert className="mb-4">{errorMessage(update.error)}</ErrorAlert>}
          {remove.isError && <ErrorAlert className="mb-4">{errorMessage(remove.error)}</ErrorAlert>}

          {/* The sidebar comes last in the page order, so the description is read first; on a phone it is
              moved up under the title with `order`, so Status and Assignee are not a scroll away. */}
          <div className="flex flex-col gap-5 @min-[700px]:grid @min-[700px]:grid-cols-[minmax(0,1fr)_14rem] @min-[700px]:gap-x-6">
            <div className="order-1 min-w-0 space-y-3 @min-[700px]:col-start-1 @min-[700px]:row-start-1">
              {ticket.blocked && (
                <section
                  aria-label="Blocked"
                  className="rounded-md border border-err bg-err-soft px-3 py-2 [&_label]:text-fg"
                >
                  <Field label="Blocked: reason">
                    {(id) => (
                      <CommitInput
                        key={k('reason', ticket.blocker_reason ?? '')}
                        id={id}
                        placeholder="Why is this blocked?"
                        value={ticket.blocker_reason ?? ''}
                        onCommit={(value) => save({ blocker_reason: value.trim() || null })}
                      />
                    )}
                  </Field>
                </section>
              )}
              <Field label="Title" hideLabel>
                {(id) => (
                  <CommitInput
                    key={k('title', ticket.title)}
                    id={id}
                    value={ticket.title}
                    maxLength={MAX_TITLE_LENGTH}
                    className={`${frameless} text-lg font-semibold`}
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
            </div>

            <div className="order-3 min-w-0 space-y-5 @min-[700px]:col-start-1 @min-[700px]:row-start-2">
              <section>
                <Field label="Description">
                  {(id) => (
                    <CommitTextarea
                      key={k('description', ticket.description ?? '')}
                      id={id}
                      rows={6}
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

              {board.agile && <DodSection ticketKey={ticket.key} />}

              {isEpic(ticket) && <FeaturePipelineSection ticket={ticket} board={board} />}

              <SubticketsSection ticket={ticket} />

              <AttachmentsSection ticketKey={ticket.key} />

              <ActivitySection ticket={ticket} />
            </div>

            <div className="order-2 min-w-0 @min-[700px]:col-start-2 @min-[700px]:row-span-2 @min-[700px]:row-start-1">
              <PropertySidebar
                ticket={ticket}
                board={board}
                shown={shown}
                addable={addable}
                onReveal={(id) => setRevealed((prev) => new Set(prev).add(id))}
                pickerOpen={pickerOpen}
                onPickerOpenChange={setPickerOpen}
                save={save}
                reset={() => setVersion((v) => v + 1)}
                keyed={k}
                onStatusChange={setMoveTo}
                people={people}
                nameOf={nameOf}
                parents={parents}
                labelSuggestions={boardLabels(boardTickets.data ?? [])}
                sprints={sprints.data}
                hasGithub={board.has_github}
              />
            </div>
          </div>
        </div>
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
