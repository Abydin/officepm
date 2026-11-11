import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@/features/auth/user-context';
import { errorMessage } from '@/lib/api';
import { projectsQuery } from './api';

export function ProjectsPage() {
  const projects = useQuery(projectsQuery);
  const user = useUser();

  return (
    <>
      <header className="mb-6">
        <h1 className="m-0 text-[22px] font-semibold">Projects</h1>
      </header>

      {projects.isPending && (
        <div
          role="status"
          aria-label="Loading projects"
          className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"
        >
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
      {projects.isError && (
        <ErrorAlert>Could not load projects. {errorMessage(projects.error)}</ErrorAlert>
      )}
      {projects.data?.length === 0 && (
        <EmptyState title="No projects yet">
          Add one to projects.json and restart the server.
        </EmptyState>
      )}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-0">
        {projects.data?.map((project) => (
          <li key={project.slug}>
            <Card className="h-full">
              <h2 className="m-0 text-[15px] font-semibold">
                <Link
                  to={`/projects/${project.slug}`}
                  className="text-fg no-underline hover:text-accent"
                >
                  {project.name}
                </Link>
              </h2>
              <p className="mt-1 mb-3 text-dim">{project.description}</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {project.boards.map((board) => (
                  <li key={board.slug}>
                    <Link
                      to={`/projects/${project.slug}/boards/${board.slug}`}
                      className="no-underline"
                    >
                      <Badge className="text-fg hover:border-line-strong">
                        {board.name} · {board.flow}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>

      {/* The server has no create-project endpoint: projects live in projects.json (PRD section 15). */}
      <Card className="mt-6" aria-labelledby="add-project-title">
        <h2 id="add-project-title" className="m-0 text-[15px] font-semibold">
          Adding a project
        </h2>
        <p className="mt-1 mb-0 text-dim">
          Projects and boards are declared in <code className="font-mono">projects.json</code>, not
          created in the app. Add an entry, then restart the server.
          {user.isAdmin ? '' : ' Ask an admin to make the change.'}
        </p>
      </Card>
    </>
  );
}
