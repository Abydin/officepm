import {
  CommentListSchema,
  CommentSchema,
  DodListSchema,
  GithubLinkListSchema,
  OkSchema,
  ParticipantSchema,
  SprintListSchema,
  TicketFileListSchema,
  TicketFileSchema,
  TicketLinkListSchema,
  TicketLinkSchema,
  TicketListSchema,
  TicketSchema,
  UserListSchema,
  type CommentCreate,
  type DodList,
  type ParticipantAdd,
  type Ticket,
  type TicketLinkCreate,
  type TicketPatch,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

const enc = encodeURIComponent;
const ticketPath = (key: string) => `/api/tickets/${enc(key)}`;

export const ticketQuery = (key: string) =>
  queryOptions({
    queryKey: qk.tickets.detail(key),
    queryFn: ({ signal }) => api.get(ticketPath(key), TicketSchema, { signal }),
  });

export const commentsQuery = (key: string) =>
  queryOptions({
    queryKey: qk.comments.list(key),
    queryFn: ({ signal }) => api.get(`${ticketPath(key)}/comments`, CommentListSchema, { signal }),
  });

export const linksQuery = (key: string) =>
  queryOptions({
    queryKey: qk.tickets.links(key),
    queryFn: ({ signal }) => api.get(`${ticketPath(key)}/links`, TicketLinkListSchema, { signal }),
  });

export const filesQuery = (key: string) =>
  queryOptions({
    queryKey: qk.tickets.files(key),
    queryFn: ({ signal }) => api.get(`${ticketPath(key)}/files`, TicketFileListSchema, { signal }),
  });

export const githubQuery = (key: string) =>
  queryOptions({
    queryKey: qk.tickets.github(key),
    queryFn: ({ signal }) => api.get(`${ticketPath(key)}/github`, GithubLinkListSchema, { signal }),
  });

export const dodQuery = (key: string) =>
  queryOptions({
    queryKey: qk.tickets.dod(key),
    queryFn: ({ signal }) => api.get(`${ticketPath(key)}/dod`, DodListSchema, { signal }),
  });

export const sprintsQuery = (slug: string, board: string) =>
  queryOptions({
    queryKey: qk.sprints.list(slug, board),
    queryFn: ({ signal }) =>
      api.get(`/api/projects/${enc(slug)}/boards/${enc(board)}/sprints`, SprintListSchema, {
        signal,
      }),
  });

export const myTicketsQuery = queryOptions({
  queryKey: qk.tickets.mine(),
  queryFn: ({ signal }) => api.get('/api/my-tickets', TicketListSchema, { signal }),
});

/** Tickets I take part in without being the assignee. Separate from My Tickets' assigned list. */
export const participatingQuery = queryOptions({
  queryKey: qk.tickets.participating(),
  queryFn: ({ signal }) => api.get('/api/my-tickets/participating', TicketListSchema, { signal }),
});

/** The palette's server-side search: capped, as v1's was. */
export const searchTicketsQuery = (q: string) =>
  queryOptions({
    queryKey: qk.tickets.search(q),
    queryFn: ({ signal }) =>
      api.get('/api/tickets', TicketListSchema, { query: { q, limit: 8 }, signal }),
  });

/** Admin only on the server. Callers must not enable it for anyone else. */
export const usersQuery = queryOptions({
  queryKey: qk.users,
  queryFn: ({ signal }) => api.get('/api/users', UserListSchema, { signal }),
  staleTime: 5 * 60_000,
});

function invalidateTickets(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
  void queryClient.invalidateQueries({ queryKey: qk.dashboard });
}

function applyPatch(ticket: Ticket, patch: TicketPatch): Ticket {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return { ...ticket, ...defined } as Ticket;
}

/**
 * Edits one ticket from the drawer. The cached ticket changes at once and goes
 * back, with the error available on the mutation, if the server refuses.
 */
export function useUpdateTicket(key: string) {
  const queryClient = useQueryClient();
  const detailKey = qk.tickets.detail(key);
  return useMutation({
    mutationFn: (patch: TicketPatch) => api.patch(ticketPath(key), TicketSchema, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      const previous = queryClient.getQueryData<Ticket>(detailKey);
      if (previous) queryClient.setQueryData(detailKey, applyPatch(previous, patch));
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
    },
    onSuccess: (ticket) => queryClient.setQueryData(detailKey, ticket),
    onSettled: () => invalidateTickets(queryClient),
  });
}

/** Assign any ticket to a person by key (the `a` shortcut). */
export function useAssignTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, assignee }: { key: string; assignee: string | null }) =>
      api.patch(ticketPath(key), TicketSchema, { assignee }),
    onSettled: () => invalidateTickets(queryClient),
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.delete(ticketPath(key), OkSchema),
    onSuccess: (_ok, key) => {
      queryClient.removeQueries({ queryKey: qk.tickets.detail(key) });
      invalidateTickets(queryClient);
    },
  });
}

export function useAddComment(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CommentCreate) =>
      api.post(`${ticketPath(key)}/comments`, CommentSchema, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.comments.list(key) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useAddLink(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TicketLinkCreate) =>
      api.post(`${ticketPath(key)}/links`, TicketLinkSchema, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.tickets.links(key) }),
  });
}

export function useRemoveLink(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${ticketPath(key)}/links/${enc(id)}`, OkSchema),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.tickets.links(key) }),
  });
}

export function useUploadFile(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post(`${ticketPath(key)}/files`, TicketFileSchema, form);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.tickets.files(key) }),
  });
}

export function useToggleDod(key: string) {
  const queryClient = useQueryClient();
  const dodKey = qk.tickets.dod(key);
  return useMutation({
    mutationFn: (input: { item: string; done: boolean }) =>
      api.patch(`${ticketPath(key)}/dod`, OkSchema, input),
    onMutate: async ({ item, done }) => {
      await queryClient.cancelQueries({ queryKey: dodKey });
      const previous = queryClient.getQueryData<DodList>(dodKey);
      queryClient.setQueryData<DodList>(dodKey, (old) =>
        old?.map((d) => (d.item === item ? { ...d, done } : d)),
      );
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) queryClient.setQueryData(dodKey, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: dodKey }),
  });
}

export function downloadUrl(ticketKey: string, fileId: string): string {
  return `${ticketPath(ticketKey)}/files/${enc(fileId)}`;
}

/** Adds a person to a ticket, or changes their role if they are on it already. */
export function useAddParticipant(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ParticipantAdd) =>
      api.post(`${ticketPath(key)}/participants`, ParticipantSchema, input),
    onSettled: () => invalidateTickets(queryClient),
  });
}

export function useRemoveParticipant(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) =>
      api.delete(`${ticketPath(key)}/participants/${userId}`, OkSchema),
    onSettled: () => invalidateTickets(queryClient),
  });
}
