import { useDraggable } from '@dnd-kit/core';
import type { Board, Ticket } from '@officepm/shared';
import { Avatar } from '@/components/avatar';
import { DueChip } from '@/components/due-chip';
import { PriorityMark } from '@/components/priority-mark';
import { dayDiff } from '@/lib/format';
import { cn } from '@/lib/utils';

const TYPE_DOT: Record<string, string> = {
  epic: 'bg-purple',
  story: 'bg-ok',
  task: 'bg-info',
  bug: 'bg-err',
};

// Text stays the plain foreground colour: tinted text on a tinted pill misses the
// 4.5:1 contrast in one theme or the other. The colour is carried by a dot or border.
function Flag({ tone, children }: { tone: 'red' | 'amber'; children: string }) {
  return (
    <span
      className={cn(
        'rounded border px-1.5 text-[10px] leading-[14px] font-semibold text-fg uppercase',
        tone === 'red' ? 'border-err bg-err-soft' : 'border-warn bg-warn-soft',
      )}
    >
      {children}
    </span>
  );
}

const STACK_MAX = 3;

/** Initials of the extra people on a ticket, overlapping, with +N for the rest. */
function ParticipantStack({ participants }: { participants: NonNullable<Ticket['participants']> }) {
  if (participants.length === 0) return null;
  const shown = participants.slice(0, STACK_MAX);
  const more = participants.length - shown.length;
  return (
    <span data-testid="participants" className="inline-flex items-center">
      {shown.map((p, i) => (
        <span
          key={p.id}
          title={p.role ? `${p.name} (${p.role})` : p.name}
          className={cn('rounded-full ring-2 ring-raised', i > 0 && '-ml-1.5')}
        >
          <Avatar who={p.name} />
        </span>
      ))}
      {more > 0 && (
        <span
          role="img"
          aria-label={`and ${more} more`}
          className="-ml-1.5 inline-flex size-6 items-center justify-center rounded-full bg-hover text-[10px] font-semibold ring-2 ring-raised"
        >
          +{more}
        </span>
      )}
    </span>
  );
}

/** What a card shows. Also the drag overlay, which is why it takes no hooks. */
export function CardFace({
  ticket,
  board,
  lifted,
}: {
  ticket: Ticket;
  board: Board;
  lifted?: boolean;
}) {
  const done = board.done_statuses.includes(ticket.status);
  const overdue = !done && ticket.due_date !== null && dayDiff(ticket.due_date) < 0;
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-raised p-2.5 text-left',
        ticket.blocked && 'border-l-[3px] border-l-err',
        lifted && 'shadow-pop',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-dim">{ticket.key}</span>
        {ticket.blocked && <Flag tone="red">Blocked</Flag>}
        {overdue && <Flag tone="amber">Overdue</Flag>}
        <span className="flex-1" />
        <PriorityMark priority={ticket.priority} />
      </div>
      <div className="my-1 break-words">{ticket.title}</div>
      {ticket.blocked && ticket.blocker_reason && (
        <div className="mb-1 text-xs text-err">Blocked: {ticket.blocker_reason}</div>
      )}
      {ticket.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {ticket.labels.slice(0, 3).map((l) => (
            <span key={l} className="rounded border border-line-strong px-1.5 text-[11px] text-dim">
              {l}
            </span>
          ))}
          {ticket.labels.length > 3 && (
            <span className="rounded border border-line-strong px-1.5 text-[11px] text-dim">
              +{ticket.labels.length - 3}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-hover px-1.5 text-[11px] leading-[18px] font-semibold text-fg">
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full', TYPE_DOT[ticket.type] ?? 'bg-gray')}
          />
          {ticket.type}
        </span>
        {board.points && ticket.points != null && (
          <span title="Story points" className="text-xs font-semibold">
            <span className="sr-only">Points </span>
            {ticket.points}
          </span>
        )}
        {ticket.appetite && (
          <span className="rounded border border-line px-1.5 text-[11px] text-dim">
            {ticket.appetite}
          </span>
        )}
        <span className="flex-1" />
        <DueChip date={ticket.due_date} done={done} />
        <ParticipantStack participants={ticket.participants ?? []} />
        <Avatar who={ticket.assignee} />
      </div>
    </div>
  );
}

interface TicketCardProps {
  ticket: Ticket;
  board: Board;
  selected: boolean;
  onOpen: (key: string) => void;
  /** Alt+Left and Alt+Right: move the card one column, no dragging needed. */
  onMoveBy: (key: string, offset: -1 | 1) => void;
}

/**
 * One draggable card. It is a single tab stop: Enter or a click opens the
 * drawer, Space picks it up for keyboard dragging, Alt+arrow nudges it a column.
 */
export function TicketCard({ ticket, board, selected, onOpen, onMoveBy }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.key });
  return (
    <div
      ref={setNodeRef}
      data-ticket-key={ticket.key}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(ticket.key)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) {
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen(ticket.key);
            return;
          }
          if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            onMoveBy(ticket.key, event.key === 'ArrowRight' ? 1 : -1);
            return;
          }
        }
        listeners?.onKeyDown?.(event);
      }}
      className={cn(
        'cursor-grab rounded-lg transition-[opacity] hover:[&>div]:border-line-strong',
        isDragging && 'opacity-40',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-lane',
      )}
    >
      <CardFace ticket={ticket} board={board} />
    </div>
  );
}
