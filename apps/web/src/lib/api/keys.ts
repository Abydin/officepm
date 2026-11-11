/**
 * Query keys, one factory per resource. Keys are arrays that go from broad to
 * specific, so `invalidateQueries({ queryKey: qk.tickets.all })` hits every
 * ticket query and a specific key hits one. Add a resource here before writing
 * its query, and invalidate by the broadest key that is still correct.
 */
export const qk = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  projects: {
    all: ['projects'] as const,
    list: () => ['projects', 'list'] as const,
    detail: (slug: string) => ['projects', 'detail', slug] as const,
    board: (slug: string, board: string) => ['projects', 'board', slug, board] as const,
  },
  // Everything about tickets sits under ['tickets'], so the server's ticket events
  // (which invalidate qk.tickets.all) refresh lists, the drawer and My Tickets alike.
  tickets: {
    all: ['tickets'] as const,
    list: (filter: { project?: string; board?: string }) => ['tickets', 'list', filter] as const,
    mine: () => ['tickets', 'mine'] as const,
    search: (q: string) => ['tickets', 'search', q] as const,
    detail: (key: string) => ['tickets', 'detail', key] as const,
    links: (key: string) => ['tickets', 'detail', key, 'links'] as const,
    files: (key: string) => ['tickets', 'detail', key, 'files'] as const,
    github: (key: string) => ['tickets', 'detail', key, 'github'] as const,
    dod: (key: string) => ['tickets', 'detail', key, 'dod'] as const,
  },
  users: ['users'] as const,
  sprints: {
    all: ['sprints'] as const,
    list: (slug: string, board: string) => ['sprints', 'list', slug, board] as const,
  },
  comments: {
    all: ['comments'] as const,
    list: (key: string) => ['comments', 'list', key] as const,
  },
  retros: { all: ['retros'] as const },
} as const;
