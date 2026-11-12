import {
  HandoffNoticeListSchema,
  HandoffResultSchema,
  OkSchema,
  PersonListSchema,
  TicketFileSchema,
  type HandoffDecision,
  type TicketFile,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

const enc = encodeURIComponent;

/** Name and department of everyone. Any signed-in user may read it (the user list itself is admin-only). */
export const peopleQuery = queryOptions({
  queryKey: qk.people,
  queryFn: ({ signal }) => api.get('/api/people', PersonListSchema, { signal }),
  staleTime: 5 * 60_000,
});

/** Handoffs addressed to me that I have not read. The server's handoff.created event refreshes it. */
export const unreadHandoffsQuery = queryOptions({
  queryKey: qk.handoffs.unread(),
  queryFn: ({ signal }) => api.get('/api/handoffs/unread', HandoffNoticeListSchema, { signal }),
});

export interface HandoffInput {
  decision: HandoffDecision;
  to_status: string;
  from_status: string;
  reason?: string;
  /** A user id from GET /api/people. */
  assignee_id?: number;
  /** More people to nudge. They become participants on the ticket. */
  participant_ids?: number[];
  department?: string;
  note?: string;
}

/**
 * Confirms a handoff. Attachments go to the ticket first (the existing upload route,
 * with its limits and blocklist), then the handoff names them. If anything fails after
 * a file went up, the files this attempt uploaded are removed again, so a refused
 * handoff leaves nothing behind on the ticket.
 */
export function useHandoff(key: string) {
  const queryClient = useQueryClient();
  const ticket = `/api/tickets/${enc(key)}`;
  return useMutation({
    mutationFn: async ({ input, files }: { input: HandoffInput; files: File[] }) => {
      const uploaded: TicketFile[] = [];
      try {
        for (const file of files) {
          const form = new FormData();
          form.append('file', file);
          uploaded.push(await api.post(`${ticket}/files`, TicketFileSchema, form));
        }
        return await api.post(`${ticket}/handoff`, HandoffResultSchema, {
          ...input,
          attachment_ids: uploaded.map((f) => f.id),
        });
      } catch (error) {
        await Promise.allSettled(
          uploaded.map((f) => api.delete(`${ticket}/files/${enc(f.id)}`, OkSchema)),
        );
        throw error;
      }
    },
    onSettled: () => {
      // The server also announces ticket.updated, comment.created and handoff.created;
      // this keeps this tab right even when the stream is down.
      void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
      void queryClient.invalidateQueries({ queryKey: qk.comments.all });
      void queryClient.invalidateQueries({ queryKey: qk.handoffs.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/** Marks every handoff on a ticket as read for me. Opening the ticket does it. */
export function useMarkHandoffsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.post(`/api/tickets/${enc(key)}/handoffs/read`, OkSchema, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.handoffs.all }),
  });
}
