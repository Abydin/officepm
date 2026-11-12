import type { PhaseMove } from '@officepm/shared';
import { timeAgo } from '@/lib/format';

const headline = (m: PhaseMove) =>
  m.completed
    ? `Completed the feature from ${m.from_phase}`
    : m.decision === 'approve'
      ? `Moved from ${m.from_phase} to ${m.to_phase}`
      : `Sent back from ${m.from_phase} to ${m.to_phase}`;

/** Who moved the feature, from where to where, and why: oldest first. */
export function PhaseHistory({ moves }: { moves: readonly PhaseMove[] }) {
  if (moves.length === 0) return null;
  return (
    <ol aria-label="Pipeline history" className="m-0 list-none space-y-2 p-0">
      {moves.map((m) => (
        <li key={m.id} className="rounded-md border border-line px-3 py-2">
          <p className="m-0 font-semibold">{headline(m)}</p>
          <p className="m-0 text-xs text-dim">
            {m.from_name} · {timeAgo(m.created_at)}
            {m.to_names.length > 0 && ` · to ${m.to_names.join(', ')}`}
            {m.to_department && ` · ${m.to_department}`}
          </p>
          {m.reason && (
            <p className="m-0 mt-1 break-words">
              <span className="text-dim">Reason: </span>
              {m.reason}
            </p>
          )}
          {m.note && <p className="m-0 mt-1 break-words">{m.note}</p>}
        </li>
      ))}
    </ol>
  );
}
