import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { docsQuery } from '@/features/docs/api';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { projectQuery } from './api';

export function ProjectPage() {
  const { slug = '' } = useParams();
  const project = useQuery(projectQuery(slug));
  const docs = useQuery(docsQuery(slug));

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
  if (!project.data) {
    return (
      <div role="status" aria-label="Loading project">
        <Skeleton className="mb-3 h-7 w-56" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const p = project.data;
  return (
    <>
      <h1 className="m-0 mb-1 text-[22px] font-semibold">{p.name}</h1>
      <p className="mt-0 mb-6 text-dim">{p.description}</p>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-0">
        {p.boards.map((board) => (
          <li key={board.slug}>
            <Link
              to={`/projects/${p.slug}/boards/${board.slug}`}
              className="block h-full rounded-lg border border-line bg-raised p-4 text-fg no-underline transition-[border-color,transform] hover:-translate-y-px hover:border-line-strong"
            >
              <div className="flex items-center justify-between">
                <strong>{board.name}</strong>
                <Badge>{board.flow}</Badge>
              </div>
              <div className="mt-1 font-mono text-dim">{board.prefix}</div>
            </Link>
          </li>
        ))}
      </ul>
      <Card aria-labelledby="project-docs" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="project-docs" className="m-0 text-[15px] font-semibold">
            Docs &amp; Links
          </h2>
          <Link to={`/projects/${p.slug}/docs`} className="text-accent">
            Manage docs and files
          </Link>
        </div>
        {docs.isError && <ErrorAlert>{errorMessage(docs.error)}</ErrorAlert>}
        {docs.data?.length === 0 && (
          <EmptyState title="No links yet">Add a spec, a design file or a runbook.</EmptyState>
        )}
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-0">
          {docs.data?.map((d) => (
            <li key={d.id} className="rounded-md border border-line bg-bg p-3">
              {d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-accent"
                >
                  {d.title}
                  <ExternalLink className="size-3" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <strong>{d.title}</strong>
              )}
              <div className="text-xs text-dim">{d.kind}</div>
              {d.body && <p className="mt-1 mb-0">{d.body}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
