import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
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

/** The projects and boards list. Rendered in the desktop sidebar and, on phones, inside the nav sheet. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const projects = useQuery(projectsQuery);

  return (
    <nav aria-label="Projects and boards" className="px-2 pt-3 pb-6">
      <Item to="/overview" onNavigate={onNavigate}>
        Overview
      </Item>
      <Item to="/projects" end onNavigate={onNavigate}>
        Projects
      </Item>

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
      {projects.data?.map((project) => (
        <div key={project.slug}>
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
        </div>
      ))}
    </nav>
  );
}
