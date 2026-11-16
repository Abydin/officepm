import { PRIORITIES, type Board, type Ticket, type TicketPatch } from '@officepm/shared';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/avatar';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Select } from '@/components/ui/select';
import { PhaseField, TeamLaneField } from '@/features/pipeline/drawer-pipeline';
import { GithubGroup, TicketStamps } from './drawer-sections';
import { cn } from '@/lib/utils';
import { CommitInput, Field, frameless } from './commit-fields';
import { PeopleSection } from './people-section';
import { parseEmail } from './people';
import type { PropertyId } from './property-visibility';

const APPETITES = ['1 week', '2 weeks', '3 weeks', '6 weeks'];
const LEVELS = ['epic', 'story', 'task', 'bug'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const timeboxLabel = (flow: Board['flow']) =>
  flow === 'shapeup' ? 'Cycle' : flow === 'waterfall' ? 'Phase' : 'Sprint';

const propertyLabel = (id: PropertyId, board: Board): string => {
  switch (id) {
    case 'priority':
      return 'Priority';
    case 'due':
      return 'Due date';
    case 'qa_owner':
      return 'QA owner';
    case 'timebox':
      return timeboxLabel(board.flow);
    case 'points':
      return 'Points';
    case 'appetite':
      return 'Appetite';
    case 'level':
      return 'Level';
    case 'epic':
      return 'Epic';
    case 'labels':
      return 'Labels';
    case 'people':
      return 'People';
    case 'blocked':
      return 'Blocked';
    case 'phase':
      return 'Phase';
    case 'team_lane':
      return 'Team lane';
  }
};

export interface PropertySidebarProps {
  ticket: Ticket;
  board: Board;
  shown: readonly PropertyId[];
  addable: readonly PropertyId[];
  onReveal: (id: PropertyId) => void;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  save: (patch: TicketPatch) => void;
  /** Puts the saved values back on screen: a typed value was refused before it was sent. */
  reset: () => void;
  /** A key that changes when the saved value does, or when a save is refused, so an input is rebuilt. */
  keyed: (name: string, value: string) => string;
  /** Asks for a move to another status; the handoff dialog confirms it. */
  onStatusChange: (status: string) => void;
  /** The directory of people to pick an assignee or QA owner from. */
  people: readonly ComboOption[];
  nameOf: (email: string) => string;
  parents: readonly ComboOption[];
  labelSuggestions: readonly string[];
  sprints: ReadonlyArray<{ id: string; name: string; status: string }> | undefined;
  hasGithub: boolean;
}

/**
 * The ticket's properties. Status and Assignee always show; every other property shows only
 * once it has a value or has been opened with "+ Add property", so a new ticket is not a wall of
 * empty boxes. Beside the main column when there is room, under the title on a phone, where
 * everything past Status and Assignee folds into "Properties (N)".
 */
export function PropertySidebar(props: PropertySidebarProps) {
  const { ticket, board, shown, addable, pickerOpen, onPickerOpenChange, save, keyed, nameOf } =
    props;
  const [expanded, setExpanded] = useState(false);
  // The row "+ Add property" just opened: focus moves into it once the picker has closed.
  const [pending, setPending] = useState<PropertyId | null>(null);

  const person = (email: string | null, empty: string) => (
    <>
      <Avatar who={email} decorative />
      <span className="min-w-0 flex-1 truncate">{email ? nameOf(email) : empty}</span>
    </>
  );

  const row = (id: PropertyId) => {
    switch (id) {
      case 'priority':
        return (
          <Field row prop={id} label="Priority">
            {(fid) => (
              <Select
                id={fid}
                className={frameless}
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
        );
      case 'due':
        return (
          <Field row prop={id} label="Due date">
            {(fid) => (
              <CommitInput
                key={keyed('due', ticket.due_date ?? '')}
                id={fid}
                className={frameless}
                type="date"
                value={ticket.due_date ?? ''}
                onCommit={(value) => save({ due_date: value || null })}
              />
            )}
          </Field>
        );
      case 'qa_owner':
        return (
          <Field row prop={id} label="QA owner">
            {(fid) => (
              <Combobox
                id={fid}
                options={props.people}
                value={ticket.qa_owner}
                triggerClassName={frameless}
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
        );
      case 'timebox':
        return (
          <Field row prop={id} label={timeboxLabel(board.flow)}>
            {(fid) => (
              <Select
                id={fid}
                className={frameless}
                value={ticket.sprint_id ?? ''}
                onChange={(e) => save({ sprint_id: e.target.value || null })}
              >
                <option value="">None</option>
                {ticket.sprint_id && !props.sprints?.some((s) => s.id === ticket.sprint_id) && (
                  <option value={ticket.sprint_id}>Unknown</option>
                )}
                {props.sprints?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.status}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        );
      case 'points':
        return (
          <Field row prop={id} label="Points">
            {(fid) => (
              <CommitInput
                key={keyed('points', String(ticket.points ?? ''))}
                id={fid}
                className={frameless}
                type="number"
                min={0}
                step={1}
                value={ticket.points == null ? '' : String(ticket.points)}
                onCommit={(value) => {
                  const n = Number(value);
                  if (value === '') save({ points: null });
                  else if (Number.isInteger(n) && n >= 0) save({ points: n });
                  else props.reset();
                }}
              />
            )}
          </Field>
        );
      case 'appetite':
        return (
          <Field row prop={id} label="Appetite">
            {(fid) => (
              <Select
                id={fid}
                className={frameless}
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
        );
      case 'level':
        return (
          <Field row prop={id} label="Level">
            {(fid) => (
              <Select
                id={fid}
                className={frameless}
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
        );
      case 'epic':
        return (
          <Field row prop={id} label="Epic">
            {(fid) => (
              <Combobox
                id={fid}
                options={props.parents}
                value={ticket.parent_key}
                triggerClassName={frameless}
                triggerLabel={`Epic: ${ticket.parent_key ?? 'None'}`}
                searchLabel="Find a ticket"
                clearOption={{ label: 'No epic', onSelect: () => save({ parent_key: null }) }}
                onSelect={(parent_key) => save({ parent_key })}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {ticket.parent_key ?? <span className="font-sans text-dim">None</span>}
                </span>
              </Combobox>
            )}
          </Field>
        );
      case 'labels':
        return (
          <LabelsField
            labels={ticket.labels}
            suggestions={props.labelSuggestions}
            onChange={(labels) => save({ labels })}
          />
        );
      case 'people':
        return <PeopleSection ticket={ticket} />;
      case 'blocked':
        return (
          <div data-prop={id}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={ticket.blocked}
                onChange={(e) => save({ blocked: e.target.checked })}
                className="size-4 accent-[var(--accent)]"
              />
              Blocked
            </label>
          </div>
        );
      case 'phase':
        return <PhaseField ticket={ticket} save={save} />;
      case 'team_lane':
        return <TeamLaneField ticket={ticket} save={save} keyed={keyed} />;
    }
  };

  const options: ComboOption[] = addable.map((id) => ({
    value: id,
    label: propertyLabel(id, board),
  }));

  return (
    <div role="group" aria-label="Properties" className="flex flex-col gap-2.5">
      <Field row prop="status" label="Status">
        {(fid) => (
          <Select
            id={fid}
            value={ticket.status}
            onChange={(e) => props.onStatusChange(e.target.value)}
          >
            {board.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field row prop="assignee" label="Assignee">
        {(fid) => (
          <Combobox
            id={fid}
            options={props.people}
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

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="more-properties"
        onClick={() => setExpanded((open) => !open)}
        className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1 text-left text-dim hover:bg-hover hover:text-fg @min-[700px]:hidden"
      >
        <ChevronDown
          className={cn('size-4 transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
        {shown.length > 0 ? `Properties (${shown.length})` : 'Details'}
      </button>

      <div
        id="more-properties"
        className={cn('flex-col gap-2.5 @min-[700px]:flex', expanded ? 'flex' : 'hidden')}
      >
        {shown.map((id) => (
          <div key={id} className="contents">
            {row(id)}
          </div>
        ))}
      </div>

      {options.length > 0 && (
        <Combobox
          options={options}
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          triggerClassName={cn(frameless, 'w-auto self-start text-dim hover:text-fg')}
          triggerLabel="Add property"
          searchLabel="Find a property"
          onSelect={(id) => {
            const chosen = addable.find((x) => x === id);
            if (!chosen) return;
            setPending(chosen);
            setExpanded(true);
            props.onReveal(chosen);
          }}
          onCloseAutoFocus={(event) => {
            if (!pending) return;
            // Land in the row that was just opened, not back on the button that opened the picker.
            const target = document.querySelector<HTMLElement>(
              `[data-prop="${pending}"] :is(select, input:not([type="hidden"]), button, textarea)`,
            );
            setPending(null);
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add property
        </Combobox>
      )}

      <div className={cn('flex-col gap-3 @min-[700px]:flex', expanded ? 'flex' : 'hidden')}>
        {props.hasGithub && <GithubGroup ticketKey={ticket.key} />}
        <div className="border-t border-line pt-3">
          <TicketStamps ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

/** Label chips with a picker for adding: existing labels on the board, or a new one (up to 8, 24 characters). */
function LabelsField({
  labels,
  suggestions,
  onChange,
}: {
  labels: string[];
  suggestions: readonly string[];
  onChange: (labels: string[]) => void;
}) {
  const full = labels.length >= 8;
  return (
    <div data-prop="labels" className="flex flex-col gap-1">
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
