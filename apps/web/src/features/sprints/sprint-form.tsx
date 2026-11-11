import { useState, type FormEvent } from 'react';
import type { Board, SprintKind } from '@officepm/shared';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useCreateSprint } from './api';
import { defaultKind, kindsFor, sprintNoun, timeboxEnd } from './sprint-plan';

const today = () => new Date().toISOString().slice(0, 10);

const KIND_LABEL: Record<SprintKind, string> = {
  sprint: 'Sprint',
  cycle: 'Cycle (6 weeks)',
  cooldown: 'Cooldown (2 weeks)',
  phase: 'Phase',
};

/**
 * Creates a sprint, cycle or phase. The dates start from today and the kind's
 * default length (PRD 6.10), shown rather than blank, which is also what the
 * server applies when it is sent none.
 */
export function SprintForm({ projectSlug, board }: { projectSlug: string; board: Board }) {
  const create = useCreateSprint(projectSlug, board.slug);
  const noun = sprintNoun(board.flow);
  const kinds = kindsFor(board.flow);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SprintKind>(defaultKind(board.flow));
  const [start, setStart] = useState(today);
  const [endOverride, setEndOverride] = useState<string | null>(null);
  const end = endOverride ?? (start ? timeboxEnd(start, kind) : '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, kind, start_date: start || null, end_date: end || null },
      {
        onSuccess: () => {
          setName('');
          setEndOverride(null);
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      aria-label={`New ${noun.toLowerCase()}`}
      className="mb-4 flex flex-wrap items-end gap-2"
    >
      <div className="min-w-40 flex-1">
        <label htmlFor="sprint-name" className="mb-1 block text-xs text-dim">
          {noun} name
        </label>
        <Input
          id="sprint-name"
          placeholder={`New ${noun.toLowerCase()} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {kinds.length > 1 && (
        <div>
          <label htmlFor="sprint-kind" className="mb-1 block text-xs text-dim">
            Kind
          </label>
          <Select
            id="sprint-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as SprintKind);
              setEndOverride(null);
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div>
        <label htmlFor="sprint-start" className="mb-1 block text-xs text-dim">
          Start date
        </label>
        <Input
          id="sprint-start"
          type="date"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            setEndOverride(null);
          }}
        />
      </div>
      <div>
        <label htmlFor="sprint-end" className="mb-1 block text-xs text-dim">
          End date
        </label>
        <Input
          id="sprint-end"
          type="date"
          value={end}
          onChange={(e) => setEndOverride(e.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
        Create {kind === 'cooldown' ? 'cooldown' : noun.toLowerCase()}
      </Button>
      {create.isError && <ErrorAlert className="w-full">{errorMessage(create.error)}</ErrorAlert>}
    </form>
  );
}
