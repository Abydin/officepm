import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Paperclip } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { DocCreate } from '@officepm/shared';
import { InlineDelete } from '@/components/inline-delete';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { projectQuery } from '@/features/projects/api';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import {
  docsQuery,
  projectFilesQuery,
  projectFileUrl,
  useAddDoc,
  useDeleteDoc,
  useDeleteProjectFile,
  useUploadProjectFile,
} from './api';

function LinksCard({ slug }: { slug: string }) {
  const docs = useQuery(docsQuery(slug));
  const add = useAddDoc(slug);
  const remove = useDeleteDoc(slug);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A bad address is the server's to explain, in its own words, so it is sent as typed.
    const input: DocCreate = { title: title.trim(), kind: 'link', url: url.trim() };
    add.mutate(input, {
      onSuccess: () => {
        setTitle('');
        setUrl('');
      },
    });
  };

  return (
    <Card aria-labelledby="docs-links" className="mb-6">
      <h2 id="docs-links" className="m-0 mb-3 text-[15px] font-semibold">
        Links
      </h2>
      <form onSubmit={submit} className="mb-4 flex flex-wrap gap-2">
        <Input
          aria-label="Link title"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-32 flex-1"
        />
        <Input
          aria-label="Link URL"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-48 flex-[2]"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!title.trim() || !url.trim() || add.isPending}
        >
          Add link
        </Button>
      </form>
      {add.isError && <ErrorAlert className="mb-3">{errorMessage(add.error)}</ErrorAlert>}
      {remove.isError && <ErrorAlert className="mb-3">{errorMessage(remove.error)}</ErrorAlert>}
      {docs.isError && <ErrorAlert>{errorMessage(docs.error)}</ErrorAlert>}
      {docs.isPending && <Skeleton className="h-16" />}
      {docs.data?.length === 0 && (
        <EmptyState title="No links yet">Add a spec, a design file or a runbook above.</EmptyState>
      )}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
        {docs.data?.map((d) => (
          <li key={d.id} className="rounded-md border border-line bg-bg p-3">
            <div className="flex items-start gap-2">
              {d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 flex-1 items-center gap-1 font-semibold text-accent"
                >
                  <span className="truncate">{d.title}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <strong className="min-w-0 flex-1 truncate">{d.title}</strong>
              )}
            </div>
            <div className="mt-1 text-xs text-dim">
              {d.kind} · {d.author} · {timeAgo(d.created_at)}
            </div>
            {d.body && <p className="mt-2 mb-0 break-words whitespace-pre-wrap">{d.body}</p>}
            <div className="mt-2">
              <InlineDelete
                name={d.title}
                pending={remove.isPending}
                onConfirm={() => remove.mutate(d.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FilesCard({ slug }: { slug: string }) {
  const files = useQuery(projectFilesQuery(slug));
  const upload = useUploadProjectFile(slug);
  const remove = useDeleteProjectFile(slug);
  const input = useRef<HTMLInputElement>(null);

  return (
    <Card aria-labelledby="docs-files">
      <h2 id="docs-files" className="m-0 mb-1 text-[15px] font-semibold">
        Files
      </h2>
      <p className="mt-0 mb-3 text-dim">
        Up to 100 files per project, 25 MB each. Not accepted: .exe, .sh, .bat, .cmd, .js, .html and
        .htm.
      </p>
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label="Project file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
      <Button onClick={() => input.current?.click()} disabled={upload.isPending}>
        <Paperclip className="size-4" aria-hidden="true" />
        {upload.isPending ? 'Uploading...' : 'Upload a file'}
      </Button>
      {upload.isError && <ErrorAlert className="mt-3">{errorMessage(upload.error)}</ErrorAlert>}
      {remove.isError && <ErrorAlert className="mt-3">{errorMessage(remove.error)}</ErrorAlert>}
      {files.isError && <ErrorAlert className="mt-3">{errorMessage(files.error)}</ErrorAlert>}
      {files.data?.length === 0 && <p className="mt-3 mb-0 text-dim">No files yet.</p>}
      <ul className="m-0 mt-3 list-none divide-y divide-line p-0">
        {files.data?.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{f.original_name}</span>
              <span className="text-xs text-dim">
                {Math.max(1, Math.round(f.size_bytes / 1024))} KB · {f.uploaded_by}
              </span>
            </span>
            <Button asChild size="sm">
              <a
                href={projectFileUrl(slug, f.id)}
                download
                aria-label={`Download ${f.original_name}`}
              >
                Download
              </a>
            </Button>
            <InlineDelete
              name={f.original_name}
              pending={remove.isPending}
              onConfirm={() => remove.mutate(f.id)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A project's reference links and uploaded files: v1's "Docs & Files". */
export function DocsPage() {
  const { slug = '' } = useParams();
  const project = useQuery(projectQuery(slug));

  if (project.isError) {
    return (
      <>
        <ErrorAlert className="mb-4">{errorMessage(project.error)}</ErrorAlert>
        <Link to="/projects" className="text-accent">
          Back to projects
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="m-0 mb-1 text-[22px] font-semibold">Docs &amp; Files</h1>
      <p className="mt-0 mb-5 text-dim">
        {project.data ? (
          <Link to={`/projects/${slug}`} className="text-accent">
            {project.data.name}
          </Link>
        ) : (
          slug
        )}
      </p>
      <LinksCard slug={slug} />
      <FilesCard slug={slug} />
    </>
  );
}
