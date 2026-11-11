import type { Sprint } from '@officepm/shared';
import { Select } from '@/components/ui/select';
import { moveTargets } from './sprint-plan';

const BACKLOG = '__backlog';

/**
 * A native select that sends a ticket to a sprint the moment one is chosen. A
 * ticket already in a sprint also gets "Back to the backlog". The select always
 * rests on its prompt, because choosing is an action, not a state: the ticket's
 * sprint is shown by where the ticket is listed.
 */
export function MoveSelect({
  label,
  prompt,
  sprints,
  currentId,
  disabled,
  onPick,
}: {
  label: string;
  prompt: string;
  sprints: Sprint[];
  currentId: string | null;
  disabled?: boolean;
  onPick: (sprintId: string | null) => void;
}) {
  return (
    <Select
      aria-label={label}
      value=""
      disabled={disabled}
      className="w-auto max-w-44"
      onChange={(e) => {
        const value = e.target.value;
        if (value === BACKLOG) onPick(null);
        else if (value) onPick(value);
      }}
    >
      <option value="">{prompt}</option>
      {currentId && <option value={BACKLOG}>Back to the backlog</option>}
      {moveTargets(sprints, currentId).map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}
