import type { Board, Ticket } from '@officepm/shared';
import { StatusDot } from '@/components/status-dot';

/**
 * A Waterfall board moves tickets through its statuses in order and will not skip
 * one, so the statuses are its phases. This shows that sequence with how many
 * tickets sit in each, above the dated phases people plan against.
 */
export function PhaseStrip({ board, tickets }: { board: Board; tickets: Ticket[] }) {
  return (
    <section aria-labelledby="phase-order" className="mb-5">
      <h2 id="phase-order" className="mt-0 mb-2 text-[15px] font-semibold">
        Phase order
      </h2>
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {board.statuses.map((status, i) => {
          const count = tickets.filter((t) => t.status === status).length;
          return (
            <li
              key={status}
              className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2"
            >
              <span className="text-xs text-dim">{i + 1}</span>
              <StatusDot status={status} />
              <span>{status}</span>
              <span className="rounded-full bg-hover px-2 text-xs text-dim">
                {count}
                <span className="sr-only"> {count === 1 ? 'ticket' : 'tickets'}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 mb-0 text-dim">
        A ticket moves one phase at a time. The board will not skip a phase.
      </p>
    </section>
  );
}
