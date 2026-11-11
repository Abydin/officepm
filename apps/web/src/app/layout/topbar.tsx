import { useQuery } from '@tanstack/react-query';
import { LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import { Link, useMatch, useNavigate } from 'react-router';
import { Avatar } from '@/components/avatar';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { useUser } from '@/features/auth/user-context';
import { projectsQuery } from '@/features/projects/api';
import { sprintsQuery } from '@/features/tickets/api';
import { useTheme } from '@/lib/theme';

const picker =
  'min-h-8 w-auto max-w-[40vw] min-w-0 cursor-pointer appearance-none truncate rounded-md border border-line-strong bg-field py-1 pr-7 pl-2.5 text-fg hover:border-dim md:max-w-60 md:min-w-[132px]';

export function Topbar({
  onOpenNav,
  onOpenPalette,
}: {
  onOpenNav: () => void;
  onOpenPalette: () => void;
}) {
  const user = useUser();
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery);
  const logout = useLogout();
  const { theme, toggle } = useTheme();
  const match = useMatch('/projects/:slug/*');
  const current = match?.params.slug ?? '';
  // v1's sprint picker: the board's sprints, and choosing one opens the backlog.
  const onBoard = useMatch('/projects/:slug/boards/:board/*');
  const boardSlug = onBoard?.params.board ?? '';
  const sprints = useQuery({
    ...sprintsQuery(current, boardSlug),
    enabled: Boolean(onBoard),
  });
  const sprintList = onBoard ? (sprints.data ?? []) : [];
  const activeSprint = sprintList.find((s) => s.status === 'active') ?? sprintList[0];

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3 md:gap-3 md:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={onOpenNav}
      >
        <Menu className="size-4" aria-hidden="true" />
      </Button>
      <Link
        to="/overview"
        className="flex items-center gap-2 font-bold tracking-[0.01em] text-fg no-underline"
      >
        <Logo />
        <span className="max-md:sr-only">OfficePM</span>
      </Link>
      <div className="relative">
        <select
          aria-label="Project"
          value={current}
          className={picker}
          onChange={(e) =>
            void navigate(e.target.value ? `/projects/${e.target.value}` : '/projects')
          }
        >
          <option value="">All projects</option>
          {projects.data?.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 10 6"
          className="pointer-events-none absolute top-1/2 right-2.5 size-2.5 -translate-y-1/2 fill-none stroke-dim stroke-[1.6]"
        >
          <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {activeSprint && (
        <div className="relative max-md:hidden">
          <select
            aria-label="Sprint"
            title="Sprints on this board. Choosing one opens the backlog."
            value={activeSprint.id}
            className={picker}
            onChange={() => void navigate(`/projects/${current}/boards/${boardSlug}/backlog`)}
          >
            {sprintList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.status}
              </option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            viewBox="0 0 10 6"
            className="pointer-events-none absolute top-1/2 right-2.5 size-2.5 -translate-y-1/2 fill-none stroke-dim stroke-[1.6]"
          >
            <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search tickets and commands"
        aria-keyshortcuts="Control+K Meta+K /"
        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-dim hover:border-dim md:w-64"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 text-left md:inline">Search tickets</span>
        <kbd className="hidden rounded border border-line-strong px-1.5 font-mono text-[11px] md:inline">
          /
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        title="Toggle theme"
      >
        {theme === 'dark' ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        )}
      </Button>
      <Avatar who={user.name || user.email} size="lg" />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        title={`Sign out ${user.email}`}
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        <LogOut className="size-4" aria-hidden="true" />
      </Button>
    </header>
  );
}
