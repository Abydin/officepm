import {
  BoardSchema,
  ProjectListSchema,
  ProjectSchema,
  TicketListSchema,
  TicketSchema,
  type Ticket,
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

/**
 * Moves a card to another column. The card jumps at once; if the server refuses
 * (a waterfall board will not skip a phase) it goes back to where it was and the
 * mutation's `error` carries the server's own message.
 */
export function useMoveTicket(project: string, board: string) {
  const queryClient = useQueryClient();
  const listKey = qk.tickets.list({ project, board });
  const setStatus = (key: string, status: string) =>
    queryClient.setQueryData<Ticket[]>(listKey, (old) =>
      old?.map((t) => (t.key === key ? { ...t, status } : t)),
    );
  return useMutation({
    mutationFn: ({ key, status }: { key: string; status: string }) =>
      api.patch(`/api/tickets/${encodeURIComponent(key)}`, TicketSchema, { status }),
    onMutate: async ({ key, status }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<Ticket[]>(listKey)?.find((t) => t.key === key);
      setStatus(key, status);
      return { previous: previous?.status };
    },
    onError: (_error, { key }, context) => {
      if (context?.previous !== undefined) setStatus(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
