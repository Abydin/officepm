import type { Ticket } from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  commentsQuery,
  dodQuery,
  downloadUrl,
  filesQuery,
  githubQuery,
  linksQuery,
  useAddComment,
  useAddLink,
  useRemoveLink,
  useToggleDod,
  useUploadFile,
} from './api';
import { SectionTitle, textareaClass } from './commit-fields';

export function DodSection({ ticketKey }: { ticketKey: string }) {
  const dod = useQuery(dodQuery(ticketKey));
  const toggle = useToggleDod(ticketKey);
  if (!dod.data || dod.data.length === 0) return null;
  return (
    <section aria-labelledby="dod-title">
      <SectionTitle id="dod-title">Definition of done</SectionTitle>
      <ul className="m-0 list-none space-y-1 p-0">
        {dod.data.map((d) => (
          <li key={d.item}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={d.done}
                onChange={(e) => toggle.mutate({ item: d.item, done: e.target.checked })}
                className="size-4 accent-[var(--accent)]"
              />
              {d.item}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The ticket's PR, deploy and release events, for the sidebar. It shows only when there are some. */
export function GithubGroup({ ticketKey }: { ticketKey: string }) {
  const events = useQuery(githubQuery(ticketKey));
  if (events.isError) return <ErrorAlert>{errorMessage(events.error)}</ErrorAlert>;
  if (!events.data || events.data.length === 0) return null;
  return (
    <section aria-labelledby="gh-title">
      <SectionTitle id="gh-title">GitHub</SectionTitle>
      <ul className="m-0 list-none space-y-2 p-0">
        {events.data.map((g) => (
          <li key={g.id} className="text-[13px] break-words">
            <Badge className="mr-1.5">{g.kind}</Badge>
            {g.repo} · {g.ref}
            {g.environment ? ` · ${g.environment}` : ''}
            <span className="ml-2 text-xs text-dim">{timeAgo(g.created_at)}</span>
            {g.url && (
              <div>
                <a
                  href={g.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-accent"
                >
                  {g.url}
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Links and files in one block. Both forms stay shut until "+ Link" or "+ File" is pressed, so a
 * ticket with nothing attached is a heading and two buttons.
 */
export function AttachmentsSection({ ticketKey }: { ticketKey: string }) {
  const links = useQuery(linksQuery(ticketKey));
  const files = useQuery(filesQuery(ticketKey));
  const addLink = useAddLink(ticketKey);
  const removeLink = useRemoveLink(ticketKey);
  const upload = useUploadFile(ticketKey);
  const input = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    addLink.mutate(
      { title: title.trim(), url: url.trim() },
      {
        onSuccess: () => {
          setTitle('');
          setUrl('');
          setLinking(false);
        },
      },
    );
  };

  return (
    <section aria-labelledby="attachments-title">
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle id="attachments-title" className="mb-0 flex-1">
          Attachments and links
        </SectionTitle>
        <Button size="sm" aria-expanded={linking} onClick={() => setLinking((open) => !open)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Link
        </Button>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label="Attachment file"
          data-testid="attachment-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <Plus className="size-3.5" aria-hidden="true" />
          {upload.isPending ? 'Uploading...' : 'File'}
        </Button>
      </div>
      {linking && (
        <form onSubmit={submit} className="mb-2 flex flex-wrap gap-2">
          <Input
            aria-label="Link title"
            placeholder="Title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-24 flex-1"
          />
          <Input
            aria-label="Link URL"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-32 flex-[2]"
          />
          <Button type="submit" disabled={!title.trim() || !url.trim() || addLink.isPending}>
            Add link
          </Button>
        </form>
      )}
      {addLink.isError && <ErrorAlert className="mb-2">{errorMessage(addLink.error)}</ErrorAlert>}
      {upload.isError && <ErrorAlert className="mb-2">{errorMessage(upload.error)}</ErrorAlert>}
      <ul className="m-0 list-none space-y-1 p-0">
        {links.data?.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 text-accent"
            >
              <span className="truncate">{l.title}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6 min-h-6"
              aria-label={`Remove link ${l.title}`}
              disabled={removeLink.isPending}
              onClick={() => removeLink.mutate(l.id)}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
        {files.data?.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {f.original_name}{' '}
              <span className="text-xs text-dim">
                {Math.max(1, Math.round(f.size_bytes / 1024))} KB · {f.uploaded_by}
              </span>
            </span>
            <Button asChild size="sm">
              <a href={downloadUrl(ticketKey, f.id)} download>
                Download<span className="sr-only"> {f.original_name}</span>
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** When the ticket was made and last changed, for the foot of the sidebar. */
export function TicketStamps({ ticket }: { ticket: Ticket }) {
  return (
    <p className="m-0 text-xs text-dim">
      Created {timeAgo(ticket.created_at)}
      <br />
      Updated {timeAgo(ticket.updated_at)}
    </p>
  );
}

/**
 * One stream of everything said on the ticket: people's comments, the GitHub bot's and each
 * handoff, in order. "Comments" hides the last two. The server keeps no other per-ticket
 * history, so there is nothing else to merge in.
 */
export function ActivitySection({ ticket }: { ticket: Ticket }) {
  const comments = useQuery(commentsQuery(ticket.key));
  const add = useAddComment(ticket.key);
  const [body, setBody] = useState('');
  const [only, setOnly] = useState<'all' | 'comments'>('all');

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate({ body: text }, { onSuccess: () => setBody('') });
  };

  const all = comments.data ?? [];
  // With nothing but people's comments there is nothing to filter out.
  const filterable = all.some((c) => c.source !== 'user');
  const shown = only === 'comments' ? all.filter((c) => c.source === 'user') : all;

  return (
    <section aria-labelledby="comments-title">
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle id="comments-title" className="mb-0 flex-1">
          Activity
        </SectionTitle>
        {filterable && (
          <div role="group" aria-label="Show in activity" className="flex gap-1">
            {(['all', 'comments'] as const).map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={only === choice ? 'primary' : 'secondary'}
                aria-pressed={only === choice}
                onClick={() => setOnly(choice)}
              >
                {choice === 'all' ? 'All' : 'Comments'}
              </Button>
            ))}
          </div>
        )}
      </div>
      {comments.isError && <ErrorAlert>{errorMessage(comments.error)}</ErrorAlert>}
      <ul aria-label="Activity" className="m-0 mb-3 list-none p-0">
        {shown.map((c) => (
          <li key={c.id} className="flex gap-2 border-b border-line py-2">
            <Avatar who={c.source === 'system' ? 'GitHub' : c.author} />
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{c.author}</span>
              {c.source === 'handoff' && <Badge className="ml-2">Handoff</Badge>}
              <span className="ml-2 text-xs text-dim">{timeAgo(c.created_at)}</span>
              <div
                className={cn(
                  'break-words whitespace-pre-wrap',
                  c.source === 'system' && 'text-dim italic',
                  c.source === 'handoff' &&
                    'mt-0.5 rounded-md border-l-[3px] border-accent bg-accent-soft px-2 py-1',
                )}
              >
                {c.body}
              </div>
            </div>
          </li>
        ))}
        {comments.data && shown.length === 0 && <li className="text-dim">No comments yet.</li>}
      </ul>
      <form onSubmit={submit}>
        <label htmlFor="new-comment" className="sr-only">
          Add a comment
        </label>
        <textarea
          id="new-comment"
          rows={2}
          placeholder="Add a comment..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          className={textareaClass}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="mt-1.5"
          disabled={!body.trim() || add.isPending}
        >
          Comment
        </Button>
      </form>
      {add.isError && <ErrorAlert className="mt-2">{errorMessage(add.error)}</ErrorAlert>}
    </section>
  );
}
