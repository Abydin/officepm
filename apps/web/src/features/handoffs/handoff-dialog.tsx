import * as Dialog from '@radix-ui/react-dialog';
import {
  HANDOFF_NOTE_MAX,
  HANDOFF_REASON_MAX,
  handoffOptions,
  transitionViolation,
  type Board,
  type HandoffDecision,
  type HandoffResult,
  type Person,
  type Ticket,
} from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Paperclip, X } from 'lucide-react';
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import { textareaClass } from '@/features/tickets/commit-fields';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { peopleQuery, useHandoff } from './api';

/** A status change that is waiting for a decision. `target` is where the person tried to put it. */
export interface HandoffRequest {
  ticket: Ticket;
  board: Board;
  target?: string | undefined;
}

interface Start {
  decision: HandoffDecision;
  to: string;
  notice: string | null;
}

/**
 * Where the dialog opens. A target the person chose (a drop, a status picked) is kept
 * when the workflow allows it, and picks the decision from its direction. One it
 * does not allow (a waterfall skip) falls back to the next status with the reason shown.
 */
function startFor({ ticket, board, target }: HandoffRequest): Start {
  const options = handoffOptions(board, ticket.status);
  const from = board.statuses.indexOf(ticket.status);
  const wanted = target === undefined ? -1 : board.statuses.indexOf(target);
  if (target !== undefined && wanted !== -1 && wanted !== from) {
    if (wanted < from) return { decision: 'reject', to: target, notice: null };
    if (options.forward.includes(target)) return { decision: 'approve', to: target, notice: null };
    if (options.next) {
      return {
        decision: 'approve',
        to: options.next,
        notice: transitionViolation(board, ticket.status, target),
      };
    }
  }
  return options.next
    ? { decision: 'approve', to: options.next, notice: null }
    : { decision: 'reject', to: options.previous ?? '', notice: null };
}

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const label = 'text-xs text-dim';

export function HandoffDialog({
  request,
  onClose,
  onDone,
}: {
  request: HandoffRequest;
  onClose: () => void;
  onDone: (result: HandoffResult) => void;
}) {
  const { ticket, board } = request;
  const options = handoffOptions(board, ticket.status);
  const [start] = useState(() => startFor(request));
  const people = useQuery(peopleQuery);
  const handoff = useHandoff(ticket.key);
  const ids = { reason: useId(), note: useId(), notice: useId() };

  const [decision, setDecision] = useState<HandoffDecision>(start.decision);
  const [to, setTo] = useState(start.to);
  const [notice, setNotice] = useState(start.notice);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [department, setDepartment] = useState('');
  const [assignee, setAssignee] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const pasted = useRef(0);
  const picker = useRef<HTMLInputElement>(null);

  const targets = decision === 'approve' ? options.forward : options.back;
  const rejecting = decision === 'reject';
  const canSend = Boolean(to) && (!rejecting || reason.trim() !== '') && !handoff.isPending;

  const everyone: Person[] = people.data ?? [];
  const departments = [
    ...new Set(everyone.map((p) => p.department).filter((d): d is string => !!d)),
  ].sort((a, b) => a.localeCompare(b));
  const candidates = department ? everyone.filter((p) => p.department === department) : everyone;

  const choose = (next: HandoffDecision) => {
    setDecision(next);
    setTo((next === 'approve' ? options.next : options.previous) ?? '');
    setNotice(null);
  };

  const addFiles = (incoming: Iterable<File>) => {
    const next = Array.from(incoming);
    if (next.length) setFiles((current) => [...current, ...next]);
  };

  const onPaste = (event: ClipboardEvent) => {
    const incoming = Array.from(event.clipboardData?.files ?? []);
    if (incoming.length === 0) return;
    event.preventDefault();
    // A screenshot from the clipboard is always called "image.png"; give each its own name.
    addFiles(
      incoming.map((file) => {
        pasted.current += 1;
        const ext = file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
        return new File([file], `pasted-image-${pasted.current}.${ext}`, { type: file.type });
      }),
    );
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  };

  const confirm = () => {
    if (!canSend) return;
    handoff.mutate(
      {
        input: {
          decision,
          to_status: to,
          from_status: ticket.status,
          ...(rejecting ? { reason: reason.trim() } : {}),
          ...(assignee ? { assignee } : {}),
          ...(department ? { department } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        files,
      },
      { onSuccess: onDone },
    );
  };

  const radio = (value: HandoffDecision, text: string, hint: string, disabled: boolean) => (
    <label
      className={cn(
        'flex min-h-8 flex-1 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5',
        decision === value ? 'border-accent bg-accent-soft' : 'border-line-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="radio"
        name="handoff-decision"
        value={value}
        checked={decision === value}
        disabled={disabled}
        onChange={() => choose(value)}
        className="mt-0.5 size-4 accent-[var(--accent)]"
      />
      <span>
        <span className="block font-semibold">{text}</span>
        <span className="block text-xs text-dim">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] animate-fade bg-black/50" />
        <Dialog.Content
          aria-describedby={`${ids.notice}-desc`}
          onPaste={onPaste}
          className="fixed top-[4vh] left-1/2 z-[60] flex max-h-[92dvh] w-[min(560px,calc(100vw-16px))] -translate-x-1/2 animate-pop flex-col rounded-xl border border-line-strong bg-raised shadow-pop focus:outline-none"
        >
          <div className="flex shrink-0 items-center border-b border-line px-4 py-3">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold">
              Move {ticket.key}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirm();
            }}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
          >
            <Dialog.Description id={`${ids.notice}-desc`} asChild>
              <div>
                <p className="m-0 font-semibold break-words">{ticket.title}</p>
                <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-dim">
                  <span data-testid="current-status">{ticket.status}</span>
                  <ArrowRight className="size-3.5" aria-label="to" />
                  <span data-testid="next-status" className="font-semibold text-fg">
                    {to || 'nowhere'}
                  </span>
                </p>
              </div>
            </Dialog.Description>

            {notice && (
              <p
                role="status"
                className="m-0 rounded-md border border-line-strong bg-hover px-3 py-2 text-[13px]"
              >
                {notice}
              </p>
            )}

            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className={cn(label, 'mb-1 p-0')}>Decision</legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                {radio(
                  'approve',
                  'Approve',
                  options.next ? 'Move it forward' : 'Nothing comes after this status',
                  options.forward.length === 0,
                )}
                {radio(
                  'reject',
                  'Reject',
                  options.previous ? 'Send it back' : 'Nothing comes before this status',
                  options.back.length === 0,
                )}
              </div>
            </fieldset>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids.notice}-to`} className={label}>
                Move to
              </label>
              <Select id={`${ids.notice}-to`} value={to} onChange={(e) => setTo(e.target.value)}>
                {targets.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </div>

            {rejecting && (
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.reason} className={label}>
                  Reason (required)
                </label>
                <textarea
                  id={ids.reason}
                  required
                  rows={3}
                  maxLength={HANDOFF_REASON_MAX}
                  placeholder="What needs to change before it can move on?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={textareaClass}
                />
              </div>
            )}

            <fieldset className="m-0 min-w-0 space-y-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-dim uppercase">
                Hand off
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={`${ids.notice}-dept`} className={label}>
                    Department
                  </label>
                  <Select
                    id={`${ids.notice}-dept`}
                    value={department}
                    onChange={(e) => {
                      setDepartment(e.target.value);
                      // A person from another department no longer fits the filter.
                      if (
                        e.target.value &&
                        everyone.find((p) => p.email === assignee)?.department !== e.target.value
                      ) {
                        setAssignee('');
                      }
                    }}
                  >
                    <option value="">Any department</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={`${ids.notice}-who`} className={label}>
                    Hand over to
                  </label>
                  <Select
                    id={`${ids.notice}-who`}
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">
                      {department ? `Anyone in ${department}` : 'Keep the current assignee'}
                    </option>
                    {department
                      ? candidates.map((p) => (
                          <option key={p.email} value={p.email}>
                            {p.name}
                          </option>
                        ))
                      : [...new Set(candidates.map((p) => p.department ?? ''))]
                          .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
                          .map((dept) => (
                            <optgroup key={dept} label={dept || 'No department'}>
                              {candidates
                                .filter((p) => (p.department ?? '') === dept)
                                .map((p) => (
                                  <option key={p.email} value={p.email}>
                                    {p.name}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.note} className={label}>
                  Note (optional)
                </label>
                <textarea
                  id={ids.note}
                  rows={3}
                  maxLength={HANDOFF_NOTE_MAX}
                  placeholder="What should the next person know?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={textareaClass}
                />
              </div>

              <div>
                <span className={cn(label, 'mb-1 block')}>Attachments (optional)</span>
                <div
                  data-testid="handoff-dropzone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-3 text-[13px] text-dim',
                    dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong',
                  )}
                >
                  <Button size="sm" onClick={() => picker.current?.click()}>
                    <Paperclip className="size-3.5" aria-hidden="true" />
                    Add files
                  </Button>
                  <span>Drop files here, or paste a screenshot.</span>
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    className="hidden"
                    aria-label="Add attachments"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      addFiles(e.target.files ?? []);
                      e.target.value = '';
                    }}
                  />
                </div>
                {files.length > 0 && (
                  <ul aria-label="Attachments to send" className="m-0 mt-2 list-none space-y-1 p-0">
                    {files.map((file, i) => (
                      <li key={`${file.name}:${i}`} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}{' '}
                          <span className="text-xs text-dim">{sizeLabel(file.size)}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </fieldset>

            {handoff.isError && <ErrorAlert>{errorMessage(handoff.error)}</ErrorAlert>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!canSend}>
                {handoff.isPending ? 'Working...' : rejecting ? 'Send back' : 'Approve and move'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
