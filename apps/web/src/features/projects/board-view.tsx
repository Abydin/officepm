import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Board, Ticket } from '@officepm/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { StatusDot } from '@/components/status-dot';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@/features/auth/user-context';
import { useBoardSelection } from '@/features/shortcuts/board-selection';
import { usePeople } from '@/features/tickets/people';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { errorMessage } from '@/lib/api';
import { personName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMoveTicket } from './api';
import {
  ASSIGNED_TO_ME,
  UNASSIGNED,
  boardLabels,
  filterTickets,
  readFilters,
  writeFilters,
} from './board-filter';
import { useBoardFrame } from './board-frame-context';
import {
  columnCoordinateGetter,
  detectColumn,
  dragAnnouncements,
  dragInstructions,
} from './board-dnd';
import { CardFace, TicketCard } from './ticket-card';

function Column({
  status,
  board,
  tickets,
  total,
  filtered,
  selectedKey,
  onOpen,
  onMoveBy,
}: {
  status: string;
  board: Board;
  tickets: Ticket[];
  total: number;
  filtered: boolean;
  selectedKey: string | null;
  onOpen: (key: string) => void;
  onMoveBy: (key: string, offset: -1 | 1) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const limit = board.wip_limits[status];
  const over = limit !== undefined && total > limit;
  return (
    <section
      ref={setNodeRef}
      aria-label={status}
      className={cn(
        'flex w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl bg-lane p-2 sm:w-auto sm:max-w-none sm:min-w-[230px] sm:flex-1 sm:basis-0',
        isOver && 'outline-2 -outline-offset-2 outline-accent',
      )}
    >
      <h2 className="m-0 flex items-center gap-2 px-1.5 pt-1 pb-2.5 text-xs font-semibold tracking-[0.05em] uppercase">
        <StatusDot status={status} />
        <span className="min-w-0 flex-1 truncate">{status}</span>
        <span
          className={cn(
            'rounded-full px-1.5 font-mono text-[11px] leading-[18px]',
            over ? 'bg-err-soft text-err' : 'bg-hover text-dim',
          )}
          title={over ? 'Over the WIP limit' : undefined}
        >
          {filtered ? `${tickets.length}/${total}` : total}
          {limit !== undefined ? ` of ${limit} max` : ''}
        </span>
      </h2>
      <ul className="m-0 flex min-h-16 list-none flex-col gap-2 p-0">
        {tickets.map((t) => (
          <li key={t.key}>
            <TicketCard
              ticket={t}
              board={board}
              selected={t.key === selectedKey}
              onOpen={onOpen}
              onMoveBy={onMoveBy}
            />
          </li>
        ))}
        {tickets.length === 0 && (
          <li className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-xs text-dim">
            No tickets
          </li>
        )}
      </ul>
    </section>
  );
}

function refocusCard(key: string) {
  const focus = () =>
    document.querySelector<HTMLElement>(`[data-ticket-key="${CSS.escape(key)}"]`)?.focus();
  // The card remounts in its new column, so wait for that before focusing it. dnd-kit then
  // tries to give focus back to the old, removed node when its drop animation ends, so
  // check again after that and take focus back only if it was lost.
  requestAnimationFrame(() => requestAnimationFrame(focus));
  setTimeout(() => {
    if (document.activeElement === document.body) focus();
  }, 400);
}

/**
 * The board tab: one column per status in the board's flow, draggable cards,
 * filters, and live updates (the app-wide event stream refreshes the ticket list).
 */
export function BoardView() {
  const { projectSlug, board, tickets } = useBoardFrame();
  const me = useUser();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const { assignee, label, q } = filters;
  const { open } = useTicketDrawer();
  const { selectedKey, keysRef } = useBoardSelection();
  const move = useMoveTicket(projectSlug, board.slug);
  const people = usePeople(tickets);
  const [dragging, setDragging] = useState<Ticket | null>(null);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click still opens the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // A short press, so a swipe on a phone still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnCoordinateGetter,
      // Enter is "open the ticket" here, so only Space picks up and drops.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const visible = useMemo(
    () => (tickets ? filterTickets(tickets, { assignee, label, q }, me.email) : []),
    [tickets, assignee, label, q, me.email],
  );
  const byStatus = (status: string, list: readonly Ticket[]) =>
    list.filter((t) => t.status === status);

  const orderedKeys = useMemo(
    () => board.statuses.flatMap((s) => visible.filter((t) => t.status === s).map((t) => t.key)),
    [board.statuses, visible],
  );
  useEffect(() => {
    keysRef.current = orderedKeys;
    return () => {
      keysRef.current = [];
    };
  }, [keysRef, orderedKeys]);
  useEffect(() => {
    if (selectedKey)
      document
        .querySelector(`[data-ticket-key="${CSS.escape(selectedKey)}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedKey]);

  const moveTo = useCallback(
    (key: string, status: string) => {
      const ticket = tickets?.find((t) => t.key === key);
      if (!ticket || ticket.status === status) return;
      move.mutate({ key, status });
      refocusCard(key);
    },
    [move, tickets],
  );

  const moveBy = useCallback(
    (key: string, offset: -1 | 1) => {
      const ticket = tickets?.find((t) => t.key === key);
      if (!ticket) return;
      const next = board.statuses[board.statuses.indexOf(ticket.status) + offset];
      if (next) moveTo(key, next);
    },
    [board.statuses, moveTo, tickets],
  );

  const onDragStart = ({ active }: DragStartEvent) =>
    setDragging(tickets?.find((t) => t.key === active.id) ?? null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (over) moveTo(String(active.id), String(over.id));
  };

  const setFilters = (next: Partial<typeof filters>) =>
    setParams(writeFilters(params, { ...filters, ...next }), { replace: true });
  const active = Boolean(filters.assignee || filters.label || filters.q);

  if (!tickets) {
    return (
      <div role="status" aria-label="Loading tickets" className="flex gap-3">
        {[3, 2, 2, 1].map((n, i) => (
          <div key={i} className="min-w-[230px] flex-1 space-y-2 rounded-xl bg-lane p-2">
            <Skeleton className="m-1.5 h-3.5 w-2/5" />
            {Array.from({ length: n }, (_, j) => (
              <Skeleton key={j} className="h-24" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const failed = move.isError ? move.variables : null;

  return (
    <>
      <div
        role="search"
        aria-label="Filter tickets"
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        <label className="flex min-w-0 flex-col gap-0.5 text-xs text-dim">
          Assignee
          <Select
            value={filters.assignee}
            onChange={(e) => setFilters({ assignee: e.target.value })}
            className="w-44"
          >
            <option value="">Anyone</option>
            <option value={ASSIGNED_TO_ME}>Me</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {people
              .filter((p) => p.value !== me.email)
              .map((p) => (
                <option key={p.value} value={p.value}>
                  {personName(p.value)}
                </option>
              ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-xs text-dim">
          Label
          <Select
            value={filters.label}
            onChange={(e) => setFilters({ label: e.target.value })}
            className="w-40"
          >
            <option value="">Any label</option>
            {boardLabels(tickets).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-xs text-dim">
          Text
          <Input
            type="search"
            placeholder="Filter by key or title"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
          />
        </label>
        {active && (
          <Button variant="ghost" onClick={() => setFilters({ assignee: '', label: '', q: '' })}>
            Clear filters
          </Button>
        )}
        <span role="status" className="ml-auto pb-1.5 text-xs text-dim">
          {active ? `${visible.length} of ${tickets.length} tickets shown` : ''}
        </span>
      </div>

      {tickets.length === 0 && (
        <EmptyState title="No tickets on this board yet" className="mb-3">
          Type a title above and press Enter. Drag cards between columns to change their status.
        </EmptyState>
      )}
      {tickets.length > 0 && visible.length === 0 && (
        <EmptyState title="No tickets match these filters" className="mb-3" />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={detectColumn}
        accessibility={{
          announcements: dragAnnouncements,
          screenReaderInstructions: dragInstructions,
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex min-h-[55vh] snap-x snap-proximity items-stretch gap-3 overflow-x-auto pb-2">
          {board.statuses.map((status) => (
            <Column
              key={status}
              status={status}
              board={board}
              tickets={byStatus(status, visible)}
              total={byStatus(status, tickets).length}
              filtered={active}
              selectedKey={selectedKey}
              onOpen={open}
              onMoveBy={moveBy}
            />
          ))}
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="cursor-grabbing">
              <CardFace ticket={dragging} board={board} lifted />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {failed && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <ErrorAlert className="pointer-events-auto flex max-w-xl items-start gap-3 shadow-pop">
            <span className="min-w-0 flex-1">
              <strong>
                {failed.key} did not move to {failed.status}.
              </strong>{' '}
              {errorMessage(move.error)}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              className="cursor-pointer rounded p-0.5 hover:bg-err/20"
              onClick={() => move.reset()}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </ErrorAlert>
        </div>
      )}
    </>
  );
}
