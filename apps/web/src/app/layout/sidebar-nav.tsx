import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { NavLink, useMatch } from 'react-router';
import type { Project } from '@officepm/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@/features/auth/user-context';
import { unreadLabel, useUnreadHandoffCount } from '@/features/handoffs/handoff-inbox';
import { projectsQuery } from '@/features/projects/api';
import { cn } from '@/lib/utils';

const item = 'relative flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-fg no-underline';
const itemActive =
  "bg-accent-soft font-semibold text-accent before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r-[3px] before:bg-accent before:content-['']";

function Item({
  to,
  end,
  onNavigate,
  children,
}: {
  to: string;
  end?: boolean;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => cn(item, isActive ? itemActive : 'hover:bg-hover')}
    >
      {children}
    </NavLink>
  );
}

function ProjectGroup({ project, onNavigate }: { project: Project; onNavigate?: () => void }) {
  return (
    <div>
      <h4 className="mx-2 mt-4 mb-1 text-[11px] font-semibold tracking-[0.07em] text-dim uppercase">
        <NavLink
          to={`/projects/${project.slug}`}
          end
          onClick={onNavigate}
          className="text-inherit no-underline hover:text-fg"
        >
          {project.name}
        </NavLink>
      </h4>
      {project.boards.map((board) => (
        <Item
          key={board.slug}
          to={`/projects/${project.slug}/boards/${board.slug}`}
          onNavigate={onNavigate}
        >
          {board.name}
        </Item>
      ))}
      <Item to={`/projects/${project.slug}/docs`} onNavigate={onNavigate}>
        <span className="text-dim">Docs &amp; Files</span>
      </Item>
    </div>
  );
}

/**
 * The sidebar. Inside a project (any route under /projects/:slug: its page, a
 * board and its views, Docs & Files, and `#/t/KEY`, which redirects to a board)
 * it lists that project alone, with a link back to all projects. On the
 * all-projects views (Overview, My Tickets, Projects, Admin) it lists every
 * project grouped, as before. Rendered in the desktop sidebar and, on phones,
 * inside the nav sheet.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const projects = useQuery(projectsQuery);
  const user = useUser();
  const unread = useUnreadHandoffCount();
  const scope = useMatch('/projects/:slug/*')?.params.slug;
  const scoped = scope ? projects.data?.find((p) => p.slug === scope) : undefined;

  return (
    <nav aria-label="Projects and boards" className="px-2 pt-3 pb-6">
      {scope ? (
        <Item to="/projects" end onNavigate={onNavigate}>
          <ArrowLeft className="size-4 shrink-0 text-dim" aria-hidden="true" />
          All projects
        </Item>
      ) : (
        <>
          <Item to="/overview" onNavigate={onNavigate}>
            Overview
          </Item>
          <Item to="/mine" onNavigate={onNavigate}>
            My Tickets
            {unread > 0 && (
              <>
                <span
                  aria-hidden="true"
                  className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center font-mono text-[11px] leading-[18px] text-accent-ink"
                >
                  {unread}
                </span>
                <span className="sr-only">, {unreadLabel(unread)}</span>
              </>
            )}
          </Item>
          <Item to="/projects" end onNavigate={onNavigate}>
            Projects
          </Item>
          {user.isAdmin && (
            <Item to="/admin" onNavigate={onNavigate}>
              Admin
            </Item>
          )}
        </>
      )}

      {projects.isPending && (
        <div role="status" aria-label="Loading projects" className="mt-4 space-y-2 px-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      )}
      {projects.isError && (
        <p className="mt-4 px-2 text-[13px] text-err">Could not load projects.</p>
      )}
      {scope
        ? projects.data &&
          (scoped ? (
            <ProjectGroup project={scoped} onNavigate={onNavigate} />
          ) : (
            <p className="mt-4 px-2 text-[13px] text-dim">Project not found.</p>
          ))
        : projects.data?.map((project) => (
            <ProjectGroup key={project.slug} project={project} onNavigate={onNavigate} />
          ))}
    </nav>
  );
}
