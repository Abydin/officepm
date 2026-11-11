import {
  BoardSchema,
  ProjectListSchema,
  ProjectSchema,
  TicketListSchema,
  TicketSchema,
  type TicketCreate,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

export const projectsQuery = queryOptions({
  queryKey: qk.projects.list(),
  queryFn: ({ signal }) => api.get('/api/projects', ProjectListSchema, { signal }),
});

export const projectQuery = (slug: string) =>
  queryOptions({
    queryKey: qk.projects.detail(slug),
    queryFn: ({ signal }) =>
      api.get(`/api/projects/${encodeURIComponent(slug)}`, ProjectSchema, { signal }),
  });

export const boardQuery = (slug: string, board: string) =>
  queryOptions({
    queryKey: qk.projects.board(slug, board),
    queryFn: ({ signal }) =>
      api.get(
        `/api/projects/${encodeURIComponent(slug)}/boards/${encodeURIComponent(board)}`,
        BoardSchema,
        {
          signal,
        },
      ),
  });

export const boardTicketsQuery = (project: string, board: string) =>
  queryOptions({
    queryKey: qk.tickets.list({ project, board }),
    queryFn: ({ signal }) =>
      api.get('/api/tickets', TicketListSchema, { query: { project, board }, signal }),
  });

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TicketCreate) => api.post('/api/tickets', TicketSchema, input),
    onSuccess: () => {
      // The server also announces ticket.created over SSE; invalidating here keeps
      // this tab correct even if the stream is down.
      void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
