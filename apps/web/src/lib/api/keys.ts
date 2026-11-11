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
  tickets: {
    all: ['tickets'] as const,
    list: (filter: { project?: string; board?: string }) => ['tickets', 'list', filter] as const,
  },
  sprints: {
    all: ['sprints'] as const,
    list: (slug: string, board: string) => ['sprints', 'list', slug, board] as const,
  },
  comments: { all: ['comments'] as const },
  retros: { all: ['retros'] as const },
} as const;
