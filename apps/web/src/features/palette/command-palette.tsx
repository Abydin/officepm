import * as Dialog from '@radix-ui/react-dialog';
import type { Board, Project } from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ArrowLeft, Keyboard, LayoutDashboard, ListChecks, Moon, Plus, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PriorityMark } from '@/components/priority-mark';
import { ErrorAlert } from '@/components/ui/alert';
import { projectsQuery, useCreateTicket } from '@/features/projects/api';
import { searchTicketsQuery } from '@/features/tickets/api';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export type PalettePage = 'root' | 'create';

type Page =
  { name: 'root' } | { name: 'pick-board' } | { name: 'title'; project: Project; board: Board };

const item =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent';
const heading =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.07em] [&_[cmdk-group-heading]]:text-dim [&_[cmdk-group-heading]]:uppercase';

const matches = (text: string, needle: string) => text.toLowerCase().includes(needle);

interface CommandPaletteProps {
  initialPage: PalettePage;
  onOpenChange: (open: boolean) => void;
  onOpenHelp: () => void;
}

/**
 * Ctrl/Cmd+K. Jump to a project, board or page, find a ticket by key or title
 * (searched on the server, capped, as v1 does), create a ticket, switch theme.
 * Mounted only while open, so it starts fresh each time.
 */
export function CommandPalette({ initialPage, onOpenChange, onOpenHelp }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { open: openTicket } = useTicketDrawer();
  const { theme, toggle } = useTheme();
  const projects = useQuery(projectsQuery);
  const create = useCreateTicket();
  const [page, setPage] = useState<Page>(
    initialPage === 'create' ? { name: 'pick-board' } : { name: 'root' },
  );
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(id);
  }, [query]);

  const searching = page.name === 'root' && debounced.length > 0;
  const results = useQuery({ ...searchTicketsQuery(debounced), enabled: searching });

  const close = () => onOpenChange(false);
  const go = (path: string) => {
    close();
    void navigate(path);
  };
  const needle = query.trim().toLowerCase();
  const show = (label: string) => !needle || matches(label, needle);

  const boards = (projects.data ?? []).flatMap((project) =>
    project.boards.map((board) => ({ project, board })),
  );

  const back = () => {
    setPage({ name: 'root' });
    setQuery('');
    create.reset();
  };

  const placeholder =
    page.name === 'root'
      ? 'Search tickets, or type a command...'
      : page.name === 'pick-board'
        ? 'Create a ticket on which board?'
        : `Title for the new ticket in ${page.board.name}`;

  const row = (icon: ReactNode, label: string) => (
    <>
      <span aria-hidden="true" className="text-dim">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(600px,calc(100vw-24px))] -translate-x-1/2 animate-pop overflow-hidden rounded-xl border border-line-strong bg-raised shadow-pop focus:outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command
            label="Search commands and tickets"
            shouldFilter={false}
            className={heading}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !query && page.name !== 'root') {
                e.preventDefault();
                back();
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              {page.name !== 'root' && (
                <button
                  type="button"
                  aria-label="Back"
                  className="cursor-pointer rounded p-1 text-dim hover:text-fg"
                  onClick={back}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
              )}
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                className="min-h-12 w-full bg-transparent py-2 text-[15px] text-fg placeholder:text-dim/80 focus:outline-none"
              />
            </div>
            <Command.List className="max-h-[min(380px,60vh)] overflow-y-auto p-1.5">
              {page.name === 'root' && (
                <>
                  {(show('create ticket') || show('new ticket')) && (
                    <Command.Group heading="Actions">
                      <Command.Item
                        value="action:create"
                        className={item}
                        onSelect={() => {
                          setPage({ name: 'pick-board' });
                          setQuery('');
                        }}
                      >
                        {row(<Plus className="size-4" />, 'Create ticket')}
                      </Command.Item>
                    </Command.Group>
                  )}
                  {searching && (
                    <Command.Group heading="Tickets">
                      {results.isFetching && !results.data && (
                        <div className="px-2.5 py-2 text-[13px] text-dim">Searching...</div>
                      )}
                      {results.isError && (
                        <ErrorAlert className="m-1.5">{errorMessage(results.error)}</ErrorAlert>
                      )}
                      {results.data?.map((t) => (
                        <Command.Item
                          key={t.key}
                          value={`ticket:${t.key}`}
                          className={item}
                          onSelect={() => {
                            close();
                            openTicket(t.key);
                          }}
                        >
                          <span className="font-mono text-xs text-dim">{t.key}</span>
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <PriorityMark priority={t.priority} />
                          <span className="text-xs text-dim">{t.status}</span>
                        </Command.Item>
                      ))}
                      {results.data?.length === 0 && (
                        <div className="px-2.5 py-2 text-[13px] text-dim">
                          No ticket matches &ldquo;{debounced}&rdquo;.
                        </div>
                      )}
                    </Command.Group>
                  )}
                  <Command.Group heading="Go to">
                    {show('overview') && (
                      <Command.Item
                        value="go:overview"
                        className={item}
                        onSelect={() => go('/overview')}
                      >
                        {row(<LayoutDashboard className="size-4" />, 'Overview')}
                      </Command.Item>
                    )}
                    {show('my tickets') && (
                      <Command.Item value="go:mine" className={item} onSelect={() => go('/mine')}>
                        {row(<ListChecks className="size-4" />, 'My Tickets')}
                      </Command.Item>
                    )}
                    {(projects.data ?? [])
                      .filter((p) => show(p.name))
                      .map((p) => (
                        <Command.Item
                          key={p.slug}
                          value={`go:project:${p.slug}`}
                          className={item}
                          onSelect={() => go(`/projects/${p.slug}`)}
                        >
                          {row(
                            <span className="text-[11px] font-bold">P</span>,
                            `Project: ${p.name}`,
                          )}
                        </Command.Item>
                      ))}
                    {boards
                      .filter(({ project, board }) => show(`${project.name} ${board.name}`))
                      .map(({ project, board }) => (
                        <Command.Item
                          key={`${project.slug}/${board.slug}`}
                          value={`go:board:${project.slug}/${board.slug}`}
                          className={item}
                          onSelect={() => go(`/projects/${project.slug}/boards/${board.slug}`)}
                        >
                          {row(
                            <span className="text-[11px] font-bold">B</span>,
                            `Board: ${project.name} / ${board.name}`,
                          )}
                        </Command.Item>
                      ))}
                  </Command.Group>
                  {(show('theme') ||
                    show('dark') ||
                    show('light') ||
                    show('shortcuts') ||
                    show('keyboard')) && (
                    <Command.Group heading="Settings">
                      {(show('theme') || show('dark') || show('light')) && (
                        <Command.Item
                          value="action:theme"
                          className={item}
                          onSelect={() => {
                            toggle();
                            close();
                          }}
                        >
                          {row(
                            theme === 'dark' ? (
                              <Sun className="size-4" />
                            ) : (
                              <Moon className="size-4" />
                            ),
                            `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
                          )}
                        </Command.Item>
                      )}
                      {(show('shortcuts') || show('keyboard')) && (
                        <Command.Item
                          value="action:help"
                          className={item}
                          onSelect={() => {
                            close();
                            onOpenHelp();
                          }}
                        >
                          {row(<Keyboard className="size-4" />, 'Keyboard shortcuts')}
                        </Command.Item>
                      )}
                    </Command.Group>
                  )}
                </>
              )}

              {page.name === 'pick-board' && (
                <Command.Group heading="Boards">
                  {boards
                    .filter(({ project, board }) => show(`${project.name} ${board.name}`))
                    .map(({ project, board }) => (
                      <Command.Item
                        key={`${project.slug}/${board.slug}`}
                        value={`create:${project.slug}/${board.slug}`}
                        className={item}
                        onSelect={() => {
                          setPage({ name: 'title', project, board });
                          setQuery('');
                        }}
                      >
                        {row(null, `${project.name} / ${board.name}`)}
                      </Command.Item>
                    ))}
                </Command.Group>
              )}

              {page.name === 'title' && (
                <Command.Group heading="Create">
                  {create.isError && (
                    <ErrorAlert className="m-1.5">{errorMessage(create.error)}</ErrorAlert>
                  )}
                  {query.trim() ? (
                    <Command.Item
                      value="create:submit"
                      className={cn(item)}
                      disabled={create.isPending}
                      onSelect={() => {
                        const type = page.board.types[0];
                        if (!type) return;
                        create.mutate(
                          {
                            project_slug: page.project.slug,
                            board_slug: page.board.slug,
                            title: query.trim(),
                            type,
                          },
                          {
                            onSuccess: (ticket) => {
                              close();
                              void navigate(
                                `/projects/${ticket.project_slug}/boards/${ticket.board_slug}?t=${encodeURIComponent(ticket.key)}`,
                                { state: { drawer: true } },
                              );
                            },
                          },
                        );
                      }}
                    >
                      {row(
                        <Plus className="size-4" />,
                        `Create "${query.trim()}" in ${page.project.name} / ${page.board.name}`,
                      )}
                    </Command.Item>
                  ) : (
                    <div className="px-2.5 py-2 text-[13px] text-dim">
                      Type a title, then press Enter.
                    </div>
                  )}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
