import {
  EpicPipelineSchema,
  PipelineConfigSchema,
  TicketSchema,
  type PipelinePut,
  type TicketCreate,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

const enc = encodeURIComponent;

/** A project's phase list: the stored one, or the built-in default with configured false. */
export const projectPipelineQuery = (slug: string) =>
  queryOptions({
    queryKey: qk.projects.pipeline(slug),
    queryFn: ({ signal }) =>
      api.get(`/api/projects/${enc(slug)}/pipeline`, PipelineConfigSchema, { signal }),
  });

/** One epic's stepper: its phases with done and total counts, and the move history. */
export const epicPipelineQuery = (key: string) =>
  queryOptions({
    queryKey: qk.tickets.pipeline(key),
    queryFn: ({ signal }) =>
      api.get(`/api/tickets/${enc(key)}/pipeline`, EpicPipelineSchema, { signal }),
  });

/** Admin only on the server: replaces the whole list. */
export function usePutPipeline(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PipelinePut) =>
      api.put(`/api/projects/${enc(slug)}/pipeline`, PipelineConfigSchema, input),
    onSuccess: (data) => queryClient.setQueryData(qk.projects.pipeline(slug), data),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projects.pipeline(slug) });
      void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
    },
  });
}

export function useStartPipeline(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/tickets/${enc(key)}/pipeline/start`, EpicPipelineSchema, {}),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.tickets.all }),
  });
}

/** A new ticket under a feature, tagged with the phase and department lane it belongs to. */
export function useAddFeatureTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TicketCreate) => api.post('/api/tickets', TicketSchema, input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
